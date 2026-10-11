import { expect, test } from "@playwright/test";

test("same-origin Socket.IO polling accepts requests without an Origin header", async ({
  request,
}) => {
  const response = await request.get(
    "/socket.io/?EIO=4&transport=polling&t=e2e",
  );

  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toMatch(/^0\{/);
});
