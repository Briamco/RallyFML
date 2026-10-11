import "dotenv/config";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import argon2 from "argon2";
import { Server } from "socket.io";
import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  charadesAnswerSchema,
  gameCreateSchema,
  gameConfigurationSchema,
  gameSettingsSchema,
  loginSchema,
  moderatorLoginSchema,
  scoreSchema,
  selectTeamSchema,
  setupSchema,
  stationAdminSchema,
  teamNamesSchema,
  triviaAnswerSchema,
} from "@rally/shared";
import { db, pool } from "./db/index.js";
import {
  admins,
  answers,
  games,
  participations,
  prompts,
  stations,
  teams,
} from "./db/schema.js";
import {
  completeGameIfDone,
  getScoreboard,
  getStationState,
  reconcileExpired,
  stationBelongsToLiveGame,
} from "./services.js";
import { createPromptOrder, scoreTriviaChoice } from "./game-rules.js";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const PgStore = connectPgSimple(session);
const cookieSecure = process.env.NODE_ENV === "production";
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const sessionMiddleware: RequestHandler = session({
  store: new PgStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
  }),
  name: "rally.sid",
  secret:
    process.env.SESSION_SECRET ?? "local-only-session-secret-change-this-value",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "strict",
    maxAge: 12 * 60 * 60 * 1000,
  },
});

function digestCredential(value: string) {
  const pepper = process.env.CREDENTIAL_PEPPER;
  if (!pepper) throw new Error("CREDENTIAL_PEPPER is required");
  return createHmac("sha256", pepper).update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new HttpError(400, "Revisa los datos ingresados.");
  }
}

function routeId(request: Request, name: string) {
  const value = request.params[name];
  if (typeof value !== "string")
    throw new HttpError(400, "Identificador no válido.");
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(400, "Identificador no válido.");
  return parsed.data;
}

function route(
  handler: (request: Request, response: Response) => unknown | Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction) =>
    Promise.resolve(handler(request, response)).catch(next);
}

function requireAdmin(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  if (!request.session.adminId)
    return next(new HttpError(401, "Inicia sesión como administrador."));
  next();
}

function requireStation(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  const stationId = request.session.stationId;
  if (!stationId)
    return next(new HttpError(401, "Ingresa la clave de esta estación."));
  void db
    .select({ sessionId: stations.moderatorSessionId })
    .from(stations)
    .where(and(eq(stations.id, stationId), isNull(stations.archivedAt)))
    .limit(1)
    .then(([station]) =>
      station?.sessionId === request.sessionID
        ? next()
        : next(
            new HttpError(
              401,
              "Esta estación ya abrió sesión en otro dispositivo.",
            ),
          ),
    )
    .catch(next);
}

function sameOrigin(request: Request, _response: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const origin = request.get("origin");
  const expected = process.env.PUBLIC_ORIGIN;
  if (!origin)
    return next(
      new HttpError(403, "La solicitud debe proceder de la aplicación."),
    );
  try {
    const allowed = expected
      ? new URL(expected).origin
      : `${request.protocol}://${request.get("host")}`;
    if (new URL(origin).origin !== allowed)
      return next(new HttpError(403, "Origen de solicitud no permitido."));
  } catch {
    return next(new HttpError(403, "Origen de solicitud no válido."));
  }
  next();
}

function promiseCallback<T>(
  work: (done: (error?: Error | null) => void) => T,
): Promise<void> {
  return new Promise((resolve, reject) =>
    work((error) => (error ? reject(error) : resolve())),
  );
}

async function currentGame() {
  const [live] = await db
    .select()
    .from(games)
    .where(eq(games.status, "live"))
    .limit(1);
  if (live) return live;
  const [setup] = await db
    .select()
    .from(games)
    .where(eq(games.status, "setup"))
    .orderBy(sql`${games.createdAt} desc`)
    .limit(1);
  return setup ?? null;
}

async function lockEditableGame(tx: DbTransaction, gameId: string) {
  const [game] = await tx
    .select()
    .from(games)
    .where(eq(games.id, gameId))
    .for("update")
    .limit(1);
  if (!game) throw new HttpError(404, "No se encontró el rally.");
  if (game.status === "live") {
    const [active] = await tx
      .select({ value: count() })
      .from(participations)
      .where(
        and(
          eq(participations.gameId, gameId),
          eq(participations.status, "active"),
        ),
      );
    if (Number(active.value))
      throw new HttpError(
        409,
        "Espera a que termine la ronda para editar la configuración.",
      );
  }
  return game;
}

async function saveTeams(
  tx: DbTransaction,
  gameId: string,
  configuredTeams: z.infer<typeof gameConfigurationSchema>["teams"],
) {
  const names = configuredTeams.map((team) => team.name);
  if (
    new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length
  )
    throw new HttpError(400, "Los nombres de equipo deben ser distintos.");
  const existing = await tx
    .select()
    .from(teams)
    .where(and(eq(teams.gameId, gameId), isNull(teams.archivedAt)))
    .orderBy(asc(teams.sortOrder))
    .for("update");
  const existingById = new Map(existing.map((team) => [team.id, team]));
  const ids = configuredTeams.flatMap((team) => (team.id ? [team.id] : []));
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !existingById.has(id))
  )
    throw new HttpError(
      400,
      "La lista de equipos contiene identificadores no válidos.",
    );
  for (const team of existing)
    await tx
      .update(teams)
      .set({ name: `editing-${randomUUID()}` })
      .where(eq(teams.id, team.id));

  const now = new Date();
  const activeIds = new Set(ids);
  const removed = existing.filter((team) => !activeIds.has(team.id));
  if (removed.length) {
    const removedIds = removed.map((team) => team.id);
    await tx
      .update(teams)
      .set({ archivedAt: now })
      .where(inArray(teams.id, removedIds));
    await tx
      .update(stations)
      .set({ selectedTeamId: null })
      .where(
        and(
          eq(stations.gameId, gameId),
          inArray(stations.selectedTeamId, removedIds),
          isNull(stations.archivedAt),
        ),
      );
  }
  for (const [sortOrder, configured] of configuredTeams.entries()) {
    if (configured.id) {
      await tx
        .update(teams)
        .set({ name: configured.name, sortOrder })
        .where(eq(teams.id, configured.id));
    } else {
      await tx
        .insert(teams)
        .values({ gameId, name: configured.name, sortOrder });
    }
  }
}

async function saveStations(
  tx: DbTransaction,
  gameId: string,
  configs: z.infer<typeof stationAdminSchema>[],
) {
  const existing = await tx
    .select()
    .from(stations)
    .where(and(eq(stations.gameId, gameId), isNull(stations.archivedAt)))
    .orderBy(asc(stations.sortOrder))
    .for("update");
  const existingById = new Map(
    existing.map((station) => [station.id, station]),
  );
  const ids = configs.flatMap((config) => (config.id ? [config.id] : []));
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !existingById.has(id))
  )
    throw new HttpError(
      400,
      "La lista de estaciones contiene identificadores no válidos.",
    );
  if (configs.some((config) => !config.id && !config.key))
    throw new HttpError(
      400,
      "Cada estación nueva necesita una clave de al menos 8 caracteres.",
    );

  const allHashes = await tx
    .select({ keyHash: stations.keyHash, id: stations.id })
    .from(stations)
    .where(and(eq(stations.gameId, gameId), isNull(stations.archivedAt)));
  const newHashes = configs.flatMap((config) =>
    config.key ? [digestCredential(config.key)] : [],
  );
  if (new Set(newHashes).size !== newHashes.length)
    throw new HttpError(409, "Cada estación debe tener una clave distinta.");
  for (const config of configs) {
    if (!config.key) continue;
    const hash = digestCredential(config.key);
    const current = allHashes.find((row) => row.keyHash === hash);
    if (current && current.id !== config.id)
      throw new HttpError(409, "Esa clave ya pertenece a otra estación.");
  }

  const now = new Date();
  const keepIds = new Set(ids);
  const removed = existing.filter((station) => !keepIds.has(station.id));
  if (removed.length) {
    const removedIds = removed.map((station) => station.id);
    await tx
      .update(prompts)
      .set({ archivedAt: now })
      .where(
        and(inArray(prompts.stationId, removedIds), isNull(prompts.archivedAt)),
      );
    await tx
      .update(stations)
      .set({
        archivedAt: now,
        selectedTeamId: null,
        moderatorSessionId: null,
        cooldownEndsAt: null,
        alarmPending: false,
      })
      .where(inArray(stations.id, removedIds));
  }

  for (const [sortOrder, config] of configs.entries()) {
    const keyHash = config.key ? digestCredential(config.key) : undefined;
    let stationId = config.id;
    if (stationId) {
      await tx
        .update(stations)
        .set({
          title: config.title,
          description: config.description,
          type: config.type,
          sortOrder,
          ...(keyHash ? { keyHash, moderatorSessionId: null } : {}),
        })
        .where(eq(stations.id, stationId));
      await tx
        .update(prompts)
        .set({ archivedAt: now })
        .where(
          and(eq(prompts.stationId, stationId), isNull(prompts.archivedAt)),
        );
    } else {
      const [station] = await tx
        .insert(stations)
        .values({
          gameId,
          title: config.title,
          description: config.description,
          type: config.type,
          keyHash: keyHash!,
          sortOrder,
        })
        .returning({ id: stations.id });
      stationId = station.id;
    }
    await tx.insert(prompts).values(
      config.prompts.map((prompt, promptOrder) => ({
        stationId: stationId!,
        content: prompt.content,
        options: config.type === "trivia" ? prompt.options : null,
        correctChoiceIndex:
          config.type === "trivia" ? prompt.correctChoiceIndex : null,
        sortOrder: promptOrder,
      })),
    );
  }
}

async function emitGame(io: Server, gameId: string) {
  const state = await getScoreboard(gameId);
  if (state) io.to(`game:${gameId}`).emit("game:update", state);
}

async function emitStation(io: Server, stationId: string) {
  const state = await getStationState(stationId);
  if (state) io.to(`station:${stationId}`).emit("station:update", state);
  if (state) await emitGame(io, state.gameId);
}

async function emitGameStations(io: Server, gameId: string) {
  const rows = await db
    .select({ id: stations.id })
    .from(stations)
    .where(and(eq(stations.gameId, gameId), isNull(stations.archivedAt)));
  for (const row of rows) {
    const state = await getStationState(row.id);
    if (state) io.to(`station:${row.id}`).emit("station:update", state);
  }
}

const stationArraySchema = stationAdminSchema;
const roundExtensionSchema = z.object({
  seconds: z.number().int().min(1).max(300),
});

export function createApp(io: Server): Express {
  const app = express();
  app.set("trust proxy", cookieSecure ? 1 : false);
  app.use(helmet({ crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(sessionMiddleware);
  app.use(sameOrigin);

  const loginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.get(
    "/api/health",
    route(async (_request, response) => {
      await pool.query("select 1");
      response.json({ ok: true });
    }),
  );

  app.get(
    "/api/setup/status",
    route(async (_request, response) => {
      const [adminCount] = await db.select({ value: count() }).from(admins);
      response.json({
        needsSetup: Number(adminCount.value) === 0,
        setupEnabled: Boolean(process.env.BOOTSTRAP_SECRET),
      });
    }),
  );

  app.post(
    "/api/setup",
    loginLimiter,
    route(async (request, response) => {
      const input = parse(setupSchema, request.body);
      const setupSecret = process.env.BOOTSTRAP_SECRET;
      if (!setupSecret || !safeEqual(input.bootstrapSecret, setupSecret))
        throw new HttpError(403, "Secreto de configuración incorrecto.");
      const [existing] = await db
        .select({ id: admins.id })
        .from(admins)
        .limit(1);
      if (existing)
        throw new HttpError(409, "La configuración inicial ya fue completada.");
      const passwordHash = await argon2.hash(input.password, {
        type: argon2.argon2id,
      });
      const [admin] = await db
        .insert(admins)
        .values({ username: input.username, passwordHash })
        .returning({ id: admins.id });
      await promiseCallback((done) => request.session.regenerate(done));
      request.session.adminId = admin.id;
      await promiseCallback((done) => request.session.save(done));
      response.status(201).json({ username: input.username });
    }),
  );

  app.post(
    "/api/admin/login",
    loginLimiter,
    route(async (request, response) => {
      const input = parse(loginSchema, request.body);
      const [admin] = await db
        .select()
        .from(admins)
        .where(eq(admins.username, input.username))
        .limit(1);
      if (!admin || !(await argon2.verify(admin.passwordHash, input.password)))
        throw new HttpError(401, "Usuario o contraseña incorrectos.");
      await promiseCallback((done) => request.session.regenerate(done));
      request.session.adminId = admin.id;
      await promiseCallback((done) => request.session.save(done));
      response.json({ username: admin.username });
    }),
  );

  app.get(
    "/api/session",
    route(async (request, response) => {
      if (request.session.adminId) {
        const [admin] = await db
          .select({ username: admins.username })
          .from(admins)
          .where(eq(admins.id, request.session.adminId))
          .limit(1);
        return response.json(
          admin ? { role: "admin", username: admin.username } : { role: null },
        );
      }
      if (request.session.stationId)
        return response.json({
          role: "moderator",
          stationId: request.session.stationId,
        });
      response.json({ role: null });
    }),
  );

  app.post(
    "/api/logout",
    route(async (request, response) => {
      if (request.session.stationId) {
        await db
          .update(stations)
          .set({ moderatorSessionId: null })
          .where(
            and(
              eq(stations.id, request.session.stationId),
              eq(stations.moderatorSessionId, request.sessionID),
            ),
          );
      }
      await promiseCallback((done) => request.session.destroy(done));
      response.clearCookie("rally.sid", {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: "strict",
      });
      response.status(204).end();
    }),
  );

  app.get(
    "/api/admin/games",
    requireAdmin,
    route(async (_request, response) => {
      response.json(
        await db
          .select()
          .from(games)
          .orderBy(sql`${games.createdAt} desc`),
      );
    }),
  );

  app.post(
    "/api/admin/games",
    requireAdmin,
    route(async (request, response) => {
      const { name } = parse(gameCreateSchema, request.body);
      const [game] = await db.insert(games).values({ name }).returning();
      await db.insert(teams).values(
        Array.from({ length: 5 }, (_, index) => ({
          gameId: game.id,
          name: `Equipo ${index + 1}`,
          sortOrder: index,
        })),
      );
      response.status(201).json(game);
    }),
  );

  app.get(
    "/api/admin/games/:gameId",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);
      if (!game) throw new HttpError(404, "No se encontró el rally.");
      const gameTeams = await db
        .select()
        .from(teams)
        .where(and(eq(teams.gameId, gameId), isNull(teams.archivedAt)))
        .orderBy(asc(teams.sortOrder));
      const gameStations = await db
        .select()
        .from(stations)
        .where(and(eq(stations.gameId, gameId), isNull(stations.archivedAt)))
        .orderBy(asc(stations.sortOrder));
      const stationIds = gameStations.map((station) => station.id);
      const allPrompts = stationIds.length
        ? await db
            .select()
            .from(prompts)
            .where(
              and(
                inArray(prompts.stationId, stationIds),
                isNull(prompts.archivedAt),
              ),
            )
            .orderBy(asc(prompts.sortOrder))
        : [];
      const [completedParticipations] = await db
        .select({ value: count() })
        .from(participations)
        .innerJoin(teams, eq(teams.id, participations.teamId))
        .innerJoin(stations, eq(stations.id, participations.stationId))
        .where(
          and(
            eq(participations.gameId, gameId),
            eq(participations.status, "completed"),
            isNull(teams.archivedAt),
            isNull(stations.archivedAt),
          ),
        );
      const expectedParticipations = gameTeams.length * gameStations.length;
      response.json({
        ...game,
        canResume:
          game.status === "completed" &&
          expectedParticipations > Number(completedParticipations.value),
        teams: gameTeams,
        stations: gameStations.map((station) => ({
          id: station.id,
          title: station.title,
          description: station.description,
          type: station.type,
          prompts: allPrompts
            .filter((prompt) => prompt.stationId === station.id)
            .map((prompt) => ({
              content: prompt.content,
              ...(prompt.options ? { options: prompt.options } : {}),
              ...(prompt.correctChoiceIndex !== null
                ? { correctChoiceIndex: prompt.correctChoiceIndex }
                : {}),
            })),
          hasKey: Boolean(station.keyHash),
        })),
      });
    }),
  );

  app.get(
    "/api/admin/games/:gameId/round",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const [game] = await db
        .select({ status: games.status })
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);
      if (!game) throw new HttpError(404, "No se encontró el rally.");

      const [gameStations, activeParticipations] = await Promise.all([
        db
          .select({
            id: stations.id,
            selectedTeamId: stations.selectedTeamId,
            alarmPending: stations.alarmPending,
            cooldownEndsAt: stations.cooldownEndsAt,
          })
          .from(stations)
          .where(and(eq(stations.gameId, gameId), isNull(stations.archivedAt))),
        db
          .select({
            stationId: participations.stationId,
            endsAt: participations.endsAt,
          })
          .from(participations)
          .where(
            and(
              eq(participations.gameId, gameId),
              eq(participations.status, "active"),
            ),
          ),
      ]);
      const now = new Date();
      const activeStationIds = new Set(
        activeParticipations.map((participation) => participation.stationId),
      );
      const ready = gameStations.filter(
        (station) =>
          station.selectedTeamId &&
          !activeStationIds.has(station.id) &&
          !station.alarmPending &&
          (!station.cooldownEndsAt || station.cooldownEndsAt <= now),
      );
      const selectedTeamCounts = new Map<string, number>();
      for (const station of ready) {
        const teamId = station.selectedTeamId!;
        selectedTeamCounts.set(
          teamId,
          (selectedTeamCounts.get(teamId) ?? 0) + 1,
        );
      }
      const latestEnd = activeParticipations.reduce<Date | null>(
        (latest, participation) =>
          !latest || participation.endsAt > latest
            ? participation.endsAt
            : latest,
        null,
      );

      response.json({
        gameStatus: game.status,
        readyStations: ready.filter(
          (station) => selectedTeamCounts.get(station.selectedTeamId!) === 1,
        ).length,
        stationCount: gameStations.length,
        activeStations: activeParticipations.length,
        endsAt: latestEnd?.toISOString() ?? null,
      });
    }),
  );

  app.put(
    "/api/admin/games/:gameId/configuration",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const configuration = parse(gameConfigurationSchema, request.body);
      const game = await db.transaction(async (tx) => {
        const current = await lockEditableGame(tx, gameId);
        await saveTeams(tx, gameId, configuration.teams);
        await saveStations(tx, gameId, configuration.stations);
        const [updated] = await tx
          .update(games)
          .set({
            name: configuration.name,
            activityDurationSeconds: configuration.activityDurationSeconds,
            cooldownSeconds: configuration.cooldownSeconds,
            ...(current.status === "completed"
              ? { podiumRevealed: false }
              : {}),
          })
          .where(eq(games.id, gameId))
          .returning();
        return updated;
      });
      await emitGame(io, gameId);
      await emitGameStations(io, gameId);
      response.json(game);
    }),
  );

  app.put(
    "/api/admin/games/:gameId/settings",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const settings = parse(gameSettingsSchema, request.body);
      const game = await db.transaction(async (tx) => {
        const current = await lockEditableGame(tx, gameId);
        const [updated] = await tx
          .update(games)
          .set({
            ...settings,
            ...(current.status === "completed"
              ? { podiumRevealed: false }
              : {}),
          })
          .where(eq(games.id, gameId))
          .returning();
        return updated;
      });
      response.json(game);
    }),
  );

  app.put(
    "/api/admin/games/:gameId/teams",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const { names } = parse(teamNamesSchema, request.body);
      await db.transaction(async (tx) => {
        const game = await lockEditableGame(tx, gameId);
        const existing = await tx
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(and(eq(teams.gameId, gameId), isNull(teams.archivedAt)));
        await saveTeams(
          tx,
          gameId,
          names.map((name) => ({
            name,
            ...(existing.find((team) => team.name === name)
              ? { id: existing.find((team) => team.name === name)!.id }
              : {}),
          })),
        );
        if (game.status === "completed")
          await tx
            .update(games)
            .set({ podiumRevealed: false })
            .where(eq(games.id, gameId));
      });
      response.json({ names });
    }),
  );

  app.put(
    "/api/admin/games/:gameId/stations",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      if (
        !Array.isArray(request.body?.stations) ||
        request.body.stations.length > 30
      )
        throw new HttpError(400, "Revisa la lista de estaciones.");
      const rawStations: unknown[] = request.body.stations;
      const configs: z.infer<typeof stationArraySchema>[] = rawStations.map(
        (item) => parse(stationArraySchema, item),
      );
      await db.transaction(async (tx) => {
        const game = await lockEditableGame(tx, gameId);
        await saveStations(tx, gameId, configs);
        if (game.status === "completed")
          await tx
            .update(games)
            .set({ podiumRevealed: false })
            .where(eq(games.id, gameId));
      });
      response.json({ saved: configs.length });
    }),
  );

  app.post(
    "/api/admin/games/:gameId/start",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const { game, gameStations } = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(games)
          .where(eq(games.id, gameId))
          .for("update")
          .limit(1);
        if (!current) throw new HttpError(404, "No se encontró el rally.");
        if (current.status !== "setup")
          throw new HttpError(
            409,
            "Solo se puede iniciar un rally en configuración.",
          );
        const [liveGame] = await tx
          .select({ id: games.id })
          .from(games)
          .where(eq(games.status, "live"))
          .limit(1);
        if (liveGame)
          throw new HttpError(
            409,
            "Termina el rally en curso antes de iniciar otro.",
          );
        const [teamCount] = await tx
          .select({ value: count() })
          .from(teams)
          .where(and(eq(teams.gameId, gameId), isNull(teams.archivedAt)));
        const gameStations = await tx
          .select()
          .from(stations)
          .where(and(eq(stations.gameId, gameId), isNull(stations.archivedAt)));
        if (Number(teamCount.value) < 1 || gameStations.length < 1)
          throw new HttpError(400, "Agrega al menos un equipo y una estación.");
        if (gameStations.length > Number(teamCount.value))
          throw new HttpError(
            400,
            "Para iniciar rondas simultáneas, agrega al menos tantos equipos como estaciones.",
          );
        const stationIds = gameStations.map((station) => station.id);
        const gamePrompts = await tx
          .select()
          .from(prompts)
          .where(
            and(
              inArray(prompts.stationId, stationIds),
              isNull(prompts.archivedAt),
            ),
          );
        if (
          gameStations.some(
            (station) =>
              !gamePrompts.some((prompt) => prompt.stationId === station.id),
          )
        )
          throw new HttpError(
            400,
            "Cada estación necesita al menos un mandato.",
          );
        if (
          gameStations.some(
            (station) =>
              station.type === "trivia" &&
              gamePrompts
                .filter((prompt) => prompt.stationId === station.id)
                .some(
                  (prompt) =>
                    !prompt.options ||
                    prompt.options.length !== 4 ||
                    prompt.correctChoiceIndex === null,
                ),
          )
        )
          throw new HttpError(
            400,
            "Completa las cuatro opciones y la respuesta correcta de cada pregunta de trivia.",
          );
        const [startedGame] = await tx
          .update(games)
          .set({ status: "live", startedAt: new Date() })
          .where(eq(games.id, gameId))
          .returning();
        return { game: startedGame, gameStations };
      });
      await emitGame(io, gameId);
      for (const station of gameStations) await emitStation(io, station.id);
      response.json(game);
    }),
  );

  app.post(
    "/api/admin/games/:gameId/round/start",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const endsAt = await db.transaction(async (tx) => {
        const [game] = await tx
          .select()
          .from(games)
          .where(eq(games.id, gameId))
          .for("update")
          .limit(1);
        if (!game) throw new HttpError(404, "No se encontró el rally.");
        if (game.status !== "live")
          throw new HttpError(409, "El rally todavía no está en vivo.");

        const gameStations = await tx
          .select()
          .from(stations)
          .where(and(eq(stations.gameId, gameId), isNull(stations.archivedAt)))
          .orderBy(asc(stations.sortOrder))
          .for("update");
        if (!gameStations.length)
          throw new HttpError(409, "El rally no tiene estaciones.");
        const now = new Date();
        if (
          gameStations.some(
            (station) =>
              !station.selectedTeamId ||
              station.alarmPending ||
              (station.cooldownEndsAt && station.cooldownEndsAt > now),
          )
        )
          throw new HttpError(
            409,
            "Espera a que todas las estaciones elijan equipo, silencien la alarma y terminen el cooldown.",
          );

        const selectedTeamIds = gameStations.map(
          (station) => station.selectedTeamId!,
        );
        if (new Set(selectedTeamIds).size !== gameStations.length)
          throw new HttpError(
            409,
            "Cada estación debe tener un equipo distinto para iniciar la ronda.",
          );
        const gameTeams = await tx
          .select({ id: teams.id })
          .from(teams)
          .where(and(eq(teams.gameId, gameId), isNull(teams.archivedAt)));
        if (gameStations.length > gameTeams.length)
          throw new HttpError(
            409,
            "Para iniciar todas las estaciones a la vez, el rally necesita al menos tantos equipos como estaciones.",
          );
        const gameTeamIds = new Set(gameTeams.map((team) => team.id));
        if (selectedTeamIds.some((teamId) => !gameTeamIds.has(teamId)))
          throw new HttpError(409, "Hay un equipo seleccionado que no existe.");

        const previousParticipations = await tx
          .select({
            teamId: participations.teamId,
            stationId: participations.stationId,
            status: participations.status,
          })
          .from(participations)
          .where(eq(participations.gameId, gameId));
        if (previousParticipations.some((item) => item.status === "active"))
          throw new HttpError(409, "La ronda anterior todavía está activa.");
        const completedPairs = new Set(
          previousParticipations
            .filter((item) => item.status === "completed")
            .map((item) => `${item.teamId}:${item.stationId}`),
        );
        if (
          gameStations.some((station) =>
            completedPairs.has(`${station.selectedTeamId}:${station.id}`),
          )
        )
          throw new HttpError(
            409,
            "Un equipo seleccionado ya completó su participación en esa estación.",
          );

        const stationIds = gameStations.map((station) => station.id);
        const promptRows = await tx
          .select({ id: prompts.id, stationId: prompts.stationId })
          .from(prompts)
          .where(
            and(
              inArray(prompts.stationId, stationIds),
              isNull(prompts.archivedAt),
            ),
          )
          .orderBy(asc(prompts.sortOrder));
        if (
          gameStations.some(
            (station) =>
              !promptRows.some((prompt) => prompt.stationId === station.id),
          )
        )
          throw new HttpError(
            409,
            "Cada estación necesita al menos un mandato.",
          );

        const roundEndsAt = new Date(
          now.getTime() + game.activityDurationSeconds * 1000,
        );
        await tx.insert(participations).values(
          gameStations.map((station) => ({
            gameId,
            teamId: station.selectedTeamId!,
            stationId: station.id,
            endsAt: roundEndsAt,
            promptOrder: createPromptOrder(
              promptRows
                .filter((prompt) => prompt.stationId === station.id)
                .map((prompt) => prompt.id),
              station.type,
            ),
          })),
        );
        await tx
          .update(stations)
          .set({ cooldownEndsAt: null })
          .where(eq(stations.gameId, gameId));
        return roundEndsAt;
      });

      await emitGameStations(io, gameId);
      response
        .status(201)
        .json({ started: true, endsAt: endsAt.toISOString() });
    }),
  );

  app.post(
    "/api/admin/games/:gameId/round/end",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const ended = await db.transaction(async (tx) => {
        const [game] = await tx
          .select({ status: games.status })
          .from(games)
          .where(eq(games.id, gameId))
          .for("update")
          .limit(1);
        if (!game) throw new HttpError(404, "No se encontró el rally.");
        if (game.status !== "live")
          throw new HttpError(409, "El rally ya no está en vivo.");
        return tx
          .update(participations)
          .set({ endsAt: new Date() })
          .where(
            and(
              eq(participations.gameId, gameId),
              eq(participations.status, "active"),
            ),
          )
          .returning({ id: participations.id });
      });
      if (!ended.length) throw new HttpError(409, "No hay una ronda activa.");
      await reconcileExpired();
      await emitGame(io, gameId);
      await emitGameStations(io, gameId);
      response.json({ ended: true });
    }),
  );

  app.post(
    "/api/admin/games/:gameId/round/extend",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const { seconds } = parse(roundExtensionSchema, request.body);
      await reconcileExpired();
      const endsAt = await db.transaction(async (tx) => {
        const [game] = await tx
          .select({ status: games.status })
          .from(games)
          .where(eq(games.id, gameId))
          .for("update")
          .limit(1);
        if (!game) throw new HttpError(404, "No se encontró el rally.");
        if (game.status !== "live")
          throw new HttpError(409, "El rally ya no está en vivo.");
        const active = await tx
          .select({ endsAt: participations.endsAt })
          .from(participations)
          .where(
            and(
              eq(participations.gameId, gameId),
              eq(participations.status, "active"),
            ),
          )
          .for("update");
        if (!active.length)
          throw new HttpError(409, "No hay una ronda activa para extender.");
        const latestEnd = Math.max(
          ...active.map((participation) => participation.endsAt.getTime()),
        );
        const extendedEnd = new Date(latestEnd + seconds * 1000);
        await tx
          .update(participations)
          .set({ endsAt: extendedEnd })
          .where(
            and(
              eq(participations.gameId, gameId),
              eq(participations.status, "active"),
            ),
          );
        return extendedEnd;
      });

      await emitGameStations(io, gameId);
      response.json({ extended: true, seconds, endsAt: endsAt.toISOString() });
    }),
  );

  app.post(
    "/api/admin/games/:gameId/finish",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const finished = await db.transaction(async (tx) => {
        const [game] = await tx
          .select()
          .from(games)
          .where(eq(games.id, gameId))
          .for("update")
          .limit(1);
        if (!game) throw new HttpError(404, "No se encontró el rally.");
        if (game.status === "completed") return false;
        if (game.status !== "live")
          throw new HttpError(409, "Solo puedes finalizar un rally en vivo.");

        const now = new Date();
        await tx
          .update(participations)
          .set({ status: "completed", completedAt: now })
          .where(
            and(
              eq(participations.gameId, gameId),
              eq(participations.status, "active"),
            ),
          );
        await tx
          .update(stations)
          .set({
            selectedTeamId: null,
            cooldownEndsAt: null,
            alarmPending: false,
          })
          .where(eq(stations.gameId, gameId));
        await tx
          .update(games)
          .set({ status: "completed", completedAt: now })
          .where(eq(games.id, gameId));
        return true;
      });

      if (finished) {
        await emitGame(io, gameId);
        await emitGameStations(io, gameId);
      }
      response.json({ completed: true });
    }),
  );

  app.post(
    "/api/admin/games/:gameId/reopen",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      await db.transaction(async (tx) => {
        const [game] = await tx
          .select({ status: games.status })
          .from(games)
          .where(eq(games.id, gameId))
          .for("update")
          .limit(1);
        if (!game) throw new HttpError(404, "No se encontró el rally.");
        if (game.status !== "completed")
          throw new HttpError(409, "Solo puedes retomar un rally finalizado.");

        const [liveGame] = await tx
          .select({ id: games.id })
          .from(games)
          .where(eq(games.status, "live"))
          .limit(1);
        if (liveGame)
          throw new HttpError(
            409,
            "Finaliza el rally en curso antes de retomar otro.",
          );

        const [[teamCount], [stationCount], [completedCount]] =
          await Promise.all([
            tx
              .select({ value: count() })
              .from(teams)
              .where(and(eq(teams.gameId, gameId), isNull(teams.archivedAt))),
            tx
              .select({ value: count() })
              .from(stations)
              .where(
                and(eq(stations.gameId, gameId), isNull(stations.archivedAt)),
              ),
            tx
              .select({ value: count() })
              .from(participations)
              .innerJoin(teams, eq(teams.id, participations.teamId))
              .innerJoin(stations, eq(stations.id, participations.stationId))
              .where(
                and(
                  eq(participations.gameId, gameId),
                  eq(participations.status, "completed"),
                  isNull(teams.archivedAt),
                  isNull(stations.archivedAt),
                ),
              ),
          ]);
        const expectedCount =
          Number(teamCount.value) * Number(stationCount.value);
        if (
          expectedCount === 0 ||
          Number(completedCount.value) >= expectedCount
        )
          throw new HttpError(
            409,
            "Este rally ya no tiene estaciones pendientes.",
          );

        await tx
          .update(games)
          .set({ status: "live", completedAt: null, podiumRevealed: false })
          .where(eq(games.id, gameId));
        await tx
          .update(stations)
          .set({
            selectedTeamId: null,
            cooldownEndsAt: null,
            alarmPending: false,
          })
          .where(eq(stations.gameId, gameId));
      });

      await emitGame(io, gameId);
      await emitGameStations(io, gameId);
      response.json({ reopened: true });
    }),
  );

  app.post(
    "/api/admin/games/:gameId/podium",
    requireAdmin,
    route(async (request, response) => {
      const gameId = routeId(request, "gameId");
      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);
      if (!game) throw new HttpError(404, "No se encontró el rally.");
      if (game.status !== "completed")
        throw new HttpError(
          409,
          "El podio estará disponible al terminar todas las estaciones.",
        );
      await db
        .update(games)
        .set({ podiumRevealed: true })
        .where(eq(games.id, gameId));
      await emitGame(io, gameId);
      response.json({ revealed: true });
    }),
  );

  app.get(
    "/api/moderator/stations",
    route(async (_request, response) => {
      const game = await currentGame();
      if (!game) return response.json([]);
      const rows = await db
        .select({ id: stations.id, title: stations.title })
        .from(stations)
        .where(and(eq(stations.gameId, game.id), isNull(stations.archivedAt)))
        .orderBy(asc(stations.sortOrder));
      response.json(rows);
    }),
  );

  app.post(
    "/api/moderator/login",
    loginLimiter,
    route(async (request, response) => {
      const input = parse(moderatorLoginSchema, request.body);
      const [station] = await db
        .select()
        .from(stations)
        .where(eq(stations.id, input.stationId))
        .limit(1);
      if (
        !station ||
        !(await stationBelongsToLiveGame(station.id)) ||
        !safeEqual(digestCredential(input.key), station.keyHash)
      ) {
        throw new HttpError(401, "Estación o clave incorrecta.");
      }
      await promiseCallback((done) => request.session.regenerate(done));
      request.session.stationId = station.id;
      await promiseCallback((done) => request.session.save(done));
      await db
        .update(stations)
        .set({ moderatorSessionId: request.sessionID })
        .where(eq(stations.id, station.id));
      response.json({ stationId: station.id });
    }),
  );

  app.get(
    "/api/station/state",
    requireStation,
    route(async (request, response) => {
      await reconcileExpired();
      const state = await getStationState(request.session.stationId!);
      if (!state) throw new HttpError(404, "No se encontró la estación.");
      response.json(state);
    }),
  );

  app.post(
    "/api/station/select",
    requireStation,
    route(async (request, response) => {
      const stationId = request.session.stationId!;
      await reconcileExpired();
      const { teamId } = parse(selectTeamSchema, request.body);
      const state = await getStationState(stationId);
      if (!state || !(await stationBelongsToLiveGame(stationId)))
        throw new HttpError(409, "El rally todavía no está en vivo.");
      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, state.gameId))
        .limit(1);
      if (game?.status !== "live")
        throw new HttpError(409, "El rally todavía no está en vivo.");
      const team = state.teams.find((item) => item.id === teamId);
      if (!team || team.completed || team.activeElsewhere || !team.available)
        throw new HttpError(
          409,
          "Ese equipo no está disponible para esta estación.",
        );
      await db
        .update(stations)
        .set({ selectedTeamId: teamId })
        .where(eq(stations.id, stationId));
      await emitStation(io, stationId);
      response.json(await getStationState(stationId));
    }),
  );

  app.post(
    "/api/station/start",
    requireStation,
    route(async () => {
      throw new HttpError(
        409,
        "El administrador inicia las actividades de todas las estaciones a la vez.",
      );
    }),
  );

  app.post(
    "/api/station/answer",
    requireStation,
    route(async (request, response) => {
      const stationId = request.session.stationId!;
      await reconcileExpired();
      const [station] = await db
        .select()
        .from(stations)
        .where(eq(stations.id, stationId))
        .limit(1);
      if (!station || !["trivia", "charades"].includes(station.type))
        throw new HttpError(
          409,
          "Esta estación no registra respuestas por pregunta.",
        );
      let promptId: string;
      let choiceIndex: number | null = null;
      let charadesCorrect: boolean | null = null;
      if (station.type === "trivia") {
        const input = parse(triviaAnswerSchema, request.body);
        promptId = input.promptId;
        choiceIndex = input.choiceIndex;
      } else {
        const input = parse(charadesAnswerSchema, request.body);
        promptId = input.promptId;
        charadesCorrect = input.correct;
      }
      const result = await db.transaction(async (tx) => {
        const [participation] = await tx
          .select()
          .from(participations)
          .where(
            and(
              eq(participations.stationId, stationId),
              eq(participations.status, "active"),
            ),
          )
          .for("update")
          .limit(1);
        if (!participation || participation.endsAt <= new Date())
          throw new HttpError(409, "El tiempo de esta actividad terminó.");
        const answered = await tx
          .select({ promptId: answers.promptId })
          .from(answers)
          .where(eq(answers.participationId, participation.id));
        const answeredIds = new Set(answered.map((item) => item.promptId));
        const nextPromptId = participation.promptOrder.find(
          (id) => !answeredIds.has(id),
        );
        if (!nextPromptId || nextPromptId !== promptId)
          throw new HttpError(409, "Registra el mandato actual una sola vez.");
        const [prompt] = await tx
          .select()
          .from(prompts)
          .where(
            and(eq(prompts.id, promptId), eq(prompts.stationId, stationId)),
          )
          .limit(1);
        if (!prompt)
          throw new HttpError(409, "El mandato ya no está disponible.");
        const correct =
          station.type === "trivia"
            ? scoreTriviaChoice(
                choiceIndex ?? -1,
                prompt.correctChoiceIndex ?? -1,
              ) === 1
            : charadesCorrect === true;
        await tx.insert(answers).values({
          participationId: participation.id,
          promptId,
          correct,
          choiceIndex,
        });
        if (correct)
          await tx
            .update(participations)
            .set({ finalScore: sql`${participations.finalScore} + 1` })
            .where(eq(participations.id, participation.id));
        return participation.id;
      });
      void result;
      await emitStation(io, stationId);
      response.json(await getStationState(stationId));
    }),
  );

  app.put(
    "/api/station/score",
    requireStation,
    route(async (request, response) => {
      const stationId = request.session.stationId!;
      await reconcileExpired();
      const { score } = parse(scoreSchema, request.body);
      const [station] = await db
        .select()
        .from(stations)
        .where(eq(stations.id, stationId))
        .limit(1);
      if (!station || ["trivia", "charades"].includes(station.type))
        throw new HttpError(
          409,
          "Esta estación puntúa las respuestas automáticamente.",
        );
      const [participation] = await db
        .update(participations)
        .set({ finalScore: score, scoreSubmittedAt: new Date() })
        .where(
          and(
            eq(participations.stationId, stationId),
            eq(participations.status, "active"),
            gt(participations.endsAt, new Date()),
            isNull(participations.scoreSubmittedAt),
          ),
        )
        .returning({ id: participations.id });
      if (!participation)
        throw new HttpError(
          409,
          "El puntaje ya fue registrado o el tiempo de esta actividad terminó.",
        );
      await emitStation(io, stationId);
      response.json(await getStationState(stationId));
    }),
  );

  app.post(
    "/api/station/alarm/silence",
    requireStation,
    route(async (request, response) => {
      const stationId = request.session.stationId!;
      await db
        .update(stations)
        .set({ alarmPending: false })
        .where(eq(stations.id, stationId));
      await emitStation(io, stationId);
      response.status(204).end();
    }),
  );

  app.get(
    "/api/games/:gameId/scoreboard",
    route(async (request, response) => {
      const scoreboard = await getScoreboard(routeId(request, "gameId"));
      if (!scoreboard) throw new HttpError(404, "No se encontró el rally.");
      response.json(scoreboard);
    }),
  );

  const webDist = resolve(
    fileURLToPath(new URL("../../web/dist", import.meta.url)),
  );
  app.use("/", express.static(webDist));
  app.get("/{*path}", (request, response, next) => {
    if (
      request.path.startsWith("/api/") ||
      request.path.startsWith("/socket.io/")
    )
      return next();
    response.sendFile("index.html", { root: webDist });
  });

  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    _next,
  ) => {
    if (error instanceof HttpError)
      return response.status(error.status).json({ error: error.message });
    const dbError = error as { code?: string; cause?: { code?: string } };
    if (dbError?.code === "23505" || dbError?.cause?.code === "23505")
      return response
        .status(409)
        .json({ error: "El dato ya existe; revisa nombres y claves." });
    const requestError = error as { type?: string; status?: number };
    if (requestError?.type === "entity.parse.failed")
      return response
        .status(400)
        .json({ error: "El cuerpo de la solicitud no es JSON válido." });
    if (requestError?.type === "entity.too.large")
      return response
        .status(413)
        .json({ error: "La solicitud supera el tamaño permitido." });
    console.error(
      "Request failed",
      error instanceof Error ? error.name : "unknown error",
    );
    if (process.env.NODE_ENV !== "production" && error instanceof Error)
      console.error(error.stack);
    response.status(500).json({ error: "Ocurrió un error interno." });
  };
  app.use(errorHandler);

  return app;
}
