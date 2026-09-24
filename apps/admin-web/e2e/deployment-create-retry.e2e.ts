import { expect, test } from "@playwright/test";

test("uncertain deployment creation retries the original request and keeps its token visible", async ({ page }) => {
  const attempts: Array<{ key: string | null; body: unknown }> = [];
  let failRefresh = false;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { setupRequired: false } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "qa", displayName: "Browser QA", enabled: true } } });
    if (path === "/api/admin/overview") return route.fulfill(failRefresh
      ? { status: 503, json: { error: "INTERNAL_ERROR" } }
      : { json: { clients: [{ id: "c1", name: "Apollo", enabled: true }], deployments: [], entitlements: [], assignments: [], versions: [{ id: "v1", version: "Rules 1", lifecycle: "ACTIVE", clinicalUsePermitted: true, isDefault: true }] } });
    if (path === "/api/admin/deployments/configuration") {
      attempts.push({ key: route.request().headers()["idempotency-key"] ?? null, body: route.request().postDataJSON() });
      if (attempts.length === 1) return route.abort("failed");
      failRefresh = true;
      return route.fulfill({ status: 201, json: { id: "d1", activation: { activationToken: "synthetic-one-time-token" } } });
    }
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });

  await page.goto("/deployments");
  await page.getByRole("button", { name: "Create deployment" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Client" }).click();
  await page.getByRole("option", { name: "Apollo" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry request" })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry request" }).click();
  await expect(dialog.getByRole("textbox", { name: "Activation token" })).toHaveValue("synthetic-one-time-token");
  expect(attempts).toHaveLength(2);
  expect(attempts[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(attempts[1]).toEqual(attempts[0]);
});
