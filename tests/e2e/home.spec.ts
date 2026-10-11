import { expect, test } from "@playwright/test";

test("the rally entry page exposes the two event roles", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /un rally/i })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Administración" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Panel de estación" }),
  ).toBeVisible();
});

test("the admin wizard configures a timed trivia station with multiple questions", async ({
  page,
}) => {
  const gameId = "28c4a3d1-12fb-493b-9e91-7d654aa31f16";
  let savedConfiguration: Record<string, any> | undefined;
  const game: Record<string, any> = {
    id: gameId,
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
    if (pathname.endsWith("/configuration") && method === "PUT") {
      savedConfiguration = route.request().postDataJSON();
      Object.assign(game, savedConfiguration);
      game.teams = savedConfiguration.teams.map(
        (team: Record<string, any>, index: number) => ({
          id: team.id ?? `team-${index + 1}`,
          name: team.name,
        }),
      );
      game.stations = savedConfiguration.stations.map(
        (station: Record<string, any>, index: number) => ({
          id: station.id ?? `4a07af18-0c8f-4d8c-8ea4-94208a10000${index}`,
          title: station.title,
          description: station.description,
          type: station.type,
          prompts: station.prompts,
          hasKey: Boolean(station.key),
        }),
      );
      return respond(game);
    }
    return route.continue();
  });

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Tiempo" })).toBeVisible();
  await page.getByLabel("Minutos de duración").selectOption("2");
  await page.getByLabel("Segundos de duración").selectOption("30");
  await page.getByLabel("Minutos de cooldown").selectOption("0");
  await page.getByLabel("Segundos de cooldown").selectOption("45");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "+ Agregar equipo" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "+ Agregar estación" }).click();
  await page.getByLabel("Título").fill("Trivia de historia");

  const fillQuestion = async (index: number, answer: string) => {
    await page
      .locator(".prompt-editor")
      .nth(index)
      .getByRole("textbox")
      .first()
      .fill(`¿Pregunta ${index + 1}?`);
    for (let choice = 0; choice < 4; choice += 1)
      await page
        .getByLabel(`Opción ${choice + 1} de la pregunta ${index + 1}`)
        .fill(`${answer} ${choice + 1}`);
    await page
      .getByRole("radio", {
        name: `Marcar opción ${index + 2} como correcta en la pregunta ${index + 1}`,
      })
      .check();
  };

  await fillQuestion(0, "Historia A");
  await page.getByRole("button", { name: "+ Agregar mandato" }).click();
  await fillQuestion(1, "Historia B");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("2 min 30 s")).toBeVisible();
  await expect(page.getByText("0 min 45 s")).toBeVisible();
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByRole("status")).toHaveText("Configuración guardada.");

  expect(savedConfiguration).toMatchObject({
    name: "Rally de prueba",
    activityDurationSeconds: 150,
    cooldownSeconds: 45,
  });
  expect(
    savedConfiguration?.teams.map((team: { name: string }) => team.name),
  ).toEqual([
    "Equipo 1",
    "Equipo 2",
    "Equipo 3",
    "Equipo 4",
    "Equipo 5",
    "Equipo 6",
  ]);
  expect(
    savedConfiguration?.teams
      .slice(0, 5)
      .map((team: { id: string }) => team.id),
  ).toEqual(["team-1", "team-2", "team-3", "team-4", "team-5"]);
  expect(savedConfiguration?.teams[5]?.id).toBeUndefined();
  expect(savedConfiguration?.stations[0]).toMatchObject({
    title: "Trivia de historia",
    type: "trivia",
    prompts: [
      {
        content: "¿Pregunta 1?",
        options: [
          "Historia A 1",
          "Historia A 2",
          "Historia A 3",
          "Historia A 4",
        ],
        correctChoiceIndex: 1,
      },
      {
        content: "¿Pregunta 2?",
        options: [
          "Historia B 1",
          "Historia B 2",
          "Historia B 3",
          "Historia B 4",
        ],
        correctChoiceIndex: 2,
      },
    ],
  });
});
