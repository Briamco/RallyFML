import { expect, test } from "@playwright/test";

test("admin can finish a live rally and reveal its podium afterward", async ({
  page,
}) => {
  const gameId = "28c4a3d1-12fb-493b-9e91-7d654aa31f16";
  let finishCount = 0;
  const game: Record<string, any> = {
    id: gameId,
    name: "Rally en vivo",
    status: "live",
    activityDurationSeconds: 120,
    cooldownSeconds: 60,
    podiumRevealed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    teams: [{ id: "team-1", name: "Equipo 1" }],
    stations: [
      {
        id: "station-1",
        title: "Trivia",
        description: "",
        type: "trivia",
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
    if (pathname === `/api/admin/games/${gameId}/finish` && method === "POST") {
      finishCount += 1;
      game.status = "completed";
      return respond({ completed: true });
    }
    return route.continue();
  });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("¿Finalizar el rally ahora?");
    await dialog.accept();
  });

  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "Finalizar rally" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finalizar rally" }).click();

  await expect(
    page.getByRole("button", { name: "Finalizar rally" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revelar podio" }),
  ).toBeVisible();
  expect(finishCount).toBe(1);
});
