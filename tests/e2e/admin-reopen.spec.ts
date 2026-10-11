import { expect, test } from "@playwright/test";

test("admin can reopen a finished rally with pending stations", async ({
  page,
}) => {
  const gameId = "28c4a3d1-12fb-493b-9e91-7d654aa31f16";
  let reopenCount = 0;
  let savedConfiguration: Record<string, any> | undefined;
  const game: Record<string, any> = {
    id: gameId,
    name: "Rally pendiente",
    status: "completed",
    activityDurationSeconds: 120,
    cooldownSeconds: 60,
    podiumRevealed: true,
    canResume: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    teams: [
      { id: "team-1", name: "Equipo 1" },
      { id: "team-2", name: "Equipo 2" },
    ],
    stations: [
      {
        id: "station-1",
        title: "Charadas",
        description: "",
        type: "charades",
        prompts: [{ content: "Imita a un animal" }],
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
    if (
      pathname === `/api/admin/games/${gameId}/configuration` &&
      method === "PUT"
    ) {
      const configuration = route.request().postDataJSON() as Record<
        string,
        any
      >;
      savedConfiguration = configuration;
      Object.assign(game, configuration, { podiumRevealed: false });
      game.teams = configuration.teams.map(
        (team: Record<string, any>, index: number) => ({
          id: team.id ?? `team-${index + 1}`,
          name: team.name,
        }),
      );
      game.stations = configuration.stations.map(
        (station: Record<string, any>) => ({
          ...station,
          hasKey: true,
        }),
      );
      return respond(game);
    }
    if (pathname === `/api/admin/games/${gameId}/reopen` && method === "POST") {
      reopenCount += 1;
      game.status = "live";
      game.podiumRevealed = false;
      game.canResume = false;
      return respond({ reopened: true });
    }
    if (pathname === `/api/admin/games/${gameId}/round`)
      return respond({
        gameStatus: "live",
        readyStations: 0,
        stationCount: 1,
        activeStations: 0,
        endsAt: null,
      });
    return route.continue();
  });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("¿Retomar este rally?");
    await dialog.accept();
  });

  await page.goto("/admin");
  await page.getByRole("button", { name: "Editar rally" }).click();
  await page.getByLabel("Nombre del rally").fill("Rally editado");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Eliminar equipo 1" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("heading", { name: "Rally editado" }),
  ).toBeVisible();
  expect(game.name).toBe("Rally editado");
  expect(savedConfiguration?.teams).toEqual([
    { id: "team-2", name: "Equipo 2" },
  ]);

  await expect(
    page.getByRole("button", { name: "Retomar rally" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retomar rally" }).click();

  await expect(
    page.getByRole("button", { name: "Finalizar rally" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retomar rally" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Iniciar tiempo de ronda" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Editar rally" }).click();
  await expect(page.getByRole("heading", { name: "Tiempo" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar edición" }).click();
  expect(reopenCount).toBe(1);
  expect(game).toMatchObject({ status: "live", podiumRevealed: false });
});
