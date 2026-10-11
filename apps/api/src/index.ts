import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { createApp, sessionMiddleware } from "./app.js";
import { pool } from "./db/index.js";
import {
  getScoreboard,
  getStationState,
  reconcileExpired,
} from "./services.js";

for (const key of ["SESSION_SECRET", "CREDENTIAL_PEPPER"] as const) {
  if ((process.env[key]?.length ?? 0) < 32)
    throw new Error(`${key} must contain at least 32 characters`);
}
if (!process.env.BOOTSTRAP_SECRET)
  console.warn(
    "BOOTSTRAP_SECRET is not set; initial administrator setup is disabled.",
  );

const origin = process.env.PUBLIC_ORIGIN;
const io = new Server({
  cors: { origin: false },
  allowRequest(request, callback) {
    const incoming = request.headers.origin;
    const host = request.headers["x-forwarded-host"] ?? request.headers.host;
    try {
      const expected = origin ? new URL(origin) : null;
      const allowed = incoming
        ? new URL(incoming).origin === (expected?.origin ?? `http://${host}`)
        : Boolean(expected && host === expected.host);
      callback(null, allowed);
    } catch {
      callback("origin rejected", false);
    }
  },
});

io.on("connection", (socket) => {
  const session = (
    socket.request as typeof socket.request & {
      session?: { stationId?: string };
    }
  ).session;
  socket.on("subscribe:game", async (value: unknown) => {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success) return;
    const gameId = parsed.data;
    const scoreboard = await getScoreboard(gameId);
    if (!scoreboard) return;
    await socket.join(`game:${gameId}`);
    socket.emit("game:update", scoreboard);
  });
  socket.on("subscribe:station", async (value: unknown) => {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success || session?.stationId !== parsed.data) return;
    await socket.join(`station:${parsed.data}`);
    const state = await getStationState(parsed.data);
    if (state) socket.emit("station:update", state);
  });
});

const app = createApp(io);
const httpServer = createServer(app);
io.attach(httpServer);
io.engine.use(sessionMiddleware);

async function refreshExpired() {
  const changed = await reconcileExpired();
  for (const gameId of changed.gameIds) {
    const scoreboard = await getScoreboard(gameId);
    if (scoreboard) io.to(`game:${gameId}`).emit("game:update", scoreboard);
    const states = await Promise.all(
      changed.stationIds.map((id) => getStationState(id)),
    );
    for (const state of states) {
      if (state?.gameId === gameId)
        io.to(`station:${state.id}`).emit("station:update", state);
    }
  }
}

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => console.log(`RallyFML API listening on ${port}`));
const timer = setInterval(
  () =>
    void refreshExpired().catch(() =>
      console.error("Timer reconciliation failed"),
    ),
  1000,
);
timer.unref();

async function shutdown() {
  clearInterval(timer);
  io.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
