import { expect, test } from "@playwright/test";

test("admin starts, extends, and ends a synchronized round", async ({
  page,
}) => {
  const gameId = "28c4a3d1-12fb-493b-9e91-7d654aa31f16";
  let readyStations = 1;
  let activeStations = 0;
  let endsAt: string | null = null;
  const calls: Array<{ path: string; body?: unknown }> = [];
  const game = {
    id: gameId,
    name: "Rally sincronizado",
    status: "live",
    activityDurationSeconds: 120,
    cooldownSeconds: 60,
    podiumRevealed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    teams: [
      { id: "team-1", name: "Equipo 1" },
      { id: "team-2", name: "Equipo 2" },
    ],
    stations: [
      {
        id: "station-1",
        title: "Trivia",
        description: "",
        type: "trivia",
        prompts: [],
      },
      {
        id: "station-2",
        title: "Charadas",
        description: "",
        type: "charades",
        prompts: [],
      },
    ],
  };

  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (pathname === "/api/setup/status")
      return respond({ needsSetup: false, setupEnabled: true });
    if (pathname === "/api/session")
      return respond({ role: "admin", username: "admin" });
    if (pathname === "/api/admin/games" && method === "GET")
      return respond([game]);
    if (pathname === `/api/admin/games/${gameId}` && method === "GET")
      return respond(game);
    if (pathname === `/api/admin/games/${gameId}/round` && method === "GET")
      return respond({
        gameStatus: "live",
        readyStations,
        stationCount: 2,
        activeStations,
        endsAt,
      });
    if (pathname === `/api/admin/games/${gameId}/round/start`) {
      calls.push({ path: "start" });
      activeStations = 2;
      endsAt = new Date(Date.now() + 120_000).toISOString();
      return respond({ started: true, endsAt }, 201);
    }
    if (pathname === `/api/admin/games/${gameId}/round/extend`) {
      const body = route.request().postDataJSON() as { seconds: number };
      calls.push({ path: "extend", body });
      endsAt = new Date(
        Date.parse(endsAt!) + body.seconds * 1000,
      ).toISOString();
      return respond({ extended: true, ...body, endsAt });
    }
    if (pathname === `/api/admin/games/${gameId}/round/end`) {
      calls.push({ path: "end" });
      activeStations = 0;
      endsAt = null;
      readyStations = 0;
      return respond({ ended: true });
    }
    return route.continue();
  });

  await page.goto("/admin");
  const start = page.getByRole("button", { name: "Iniciar tiempo de ronda" });
  await expect(start).toBeDisabled();
  readyStations = 2;
  await expect(start).toBeEnabled({ timeout: 3_000 });
  await start.click();
  await expect(
    page.getByRole("button", { name: "Editar rally" }),
  ).toBeDisabled();

  const extend = page.getByRole("button", { name: "Extender tiempo" });
  await expect(extend).toBeVisible();
  await page.getByLabel("Extender (segundos)").fill("45");
  await extend.click();
  expect(calls).toContainEqual({ path: "extend", body: { seconds: 45 } });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Terminar ronda" }).click();
  await expect(start).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Editar rally" }),
  ).toBeEnabled();
  expect(calls.map((call) => call.path)).toEqual(["start", "extend", "end"]);
});

test("configuration rejects more stations than teams", async ({ page }) => {
  const game = {
    id: "28c4a3d1-12fb-493b-9e91-7d654aa31f16",
    name: "Rally de prueba",
    status: "setup",
    activityDurationSeconds: 120,
    cooldownSeconds: 60,
    podiumRevealed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    teams: Array.from({ length: 5 }, (_, index) => ({
      id: `team-${index + 1}`,
      name: `Equipo ${index + 1}`,
    })),
    stations: [],
  };

  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/setup/status")
      return route.fulfill({ json: { needsSetup: false, setupEnabled: true } });
    if (pathname === "/api/session")
      return route.fulfill({ json: { role: "admin", username: "admin" } });
    if (pathname === "/api/admin/games") return route.fulfill({ json: [game] });
    if (pathname.endsWith(`/${game.id}`)) return route.fulfill({ json: game });
    return route.continue();
  });

  await page.goto("/admin");
  await page.getByRole("button", { name: "Continuar" }).click();
  for (let index = 0; index < 4; index += 1)
    await page
      .getByRole("button", { name: /Eliminar equipo/ })
      .last()
      .click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "+ Agregar estación" }).click();
  await page.getByRole("button", { name: "+ Agregar estación" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(
    page.getByRole("alert").filter({
      hasText:
        "Para sincronizar todas las estaciones, debe haber al menos tantos equipos como estaciones.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Estaciones" })).toBeVisible();
});
