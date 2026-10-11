import { expect, test, type Page } from "@playwright/test";

async function mockModeratorAlarm(page: Page) {
  let alarmPending = true;
  let silenceCount = 0;
  const state = {
    id: "station-id",
    gameId: "game-id",
    title: "Estación de trivia",
    description: "",
    gameStatus: "live" as const,
    type: "trivia" as const,
    durationSeconds: 120,
    selectedTeamId: null,
    cooldownEndsAt: null,
    activeParticipation: null,
    teams: [],
  };

  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { role: "moderator", stationId: state.id } }),
  );
  await page.route("**/api/station/state", (route) =>
    route.fulfill({ json: { ...state, alarmPending } }),
  );
  await page.route("**/api/station/alarm/silence", async (route) => {
    silenceCount += 1;
    alarmPending = false;
    await route.fulfill({ status: 204 });
  });

  return () => ({ alarmPending, silenceCount });
}

test("alarm stays visible until the moderator closes it", async ({ page }) => {
  const getAlarmState = await mockModeratorAlarm(page);
  await page.goto("/station");

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".alarm-bell")).toHaveText("🔔");
  await page.waitForTimeout(2_100);
  await expect(dialog).toBeVisible();
  expect(getAlarmState()).toEqual({ alarmPending: true, silenceCount: 0 });

  await page.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toBeHidden();
  expect(getAlarmState()).toEqual({ alarmPending: false, silenceCount: 1 });
});
