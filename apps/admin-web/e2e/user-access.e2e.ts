import { expect, test } from "@playwright/test";

test("changing administrator access requires confirmation", async ({ page }) => {
  let enabled = true;
  const changes: boolean[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { setupRequired: false } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "self", email: "self@example.test", displayName: "Current Admin", enabled: true, createdAt: "2026-09-01T00:00:00Z" } } });
    if (path === "/api/admin/overview") return route.fulfill({ json: { clients: [], deployments: [], assignments: [], entitlements: [], versions: [] } });
    if (path === "/api/admin/users" && route.request().method() === "GET") return route.fulfill({ json: {
      users: [
        { id: "self", email: "self@example.test", displayName: "Current Admin", enabled: true, createdAt: "2026-09-01T00:00:00Z" },
        { id: "other", email: "other@example.test", displayName: "Audit Operator", enabled, createdAt: "2026-09-01T00:00:00Z" },
      ],
      invitations: [],
    } });
    if (path === "/api/admin/users/other/enabled" && route.request().method() === "PATCH") {
      enabled = route.request().postDataJSON().enabled;
      changes.push(enabled);
      return route.fulfill({ json: { id: "other", enabled } });
    }
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });

  await page.goto("/users");
  await page.getByRole("button", { name: "Disable Audit Operator" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Disable Audit Operator?");
  expect(changes).toEqual([]);
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  expect(changes).toEqual([]);

  await page.getByRole("button", { name: "Disable Audit Operator" }).click();
  await confirmation.getByRole("button", { name: "Disable access" }).click();
  await expect(page.getByRole("button", { name: "Enable Audit Operator" })).toBeVisible();
  expect(changes).toEqual([false]);

  await page.getByRole("button", { name: "Enable Audit Operator" }).click();
  await expect(confirmation).toContainText("Enable Audit Operator?");
  expect(changes).toEqual([false]);
  await confirmation.getByRole("button", { name: "Enable access" }).click();
  await expect(page.getByRole("button", { name: "Disable Audit Operator" })).toBeVisible();
  expect(changes).toEqual([false, true]);
});
