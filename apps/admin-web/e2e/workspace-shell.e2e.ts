import { expect, test } from "@playwright/test";

test("scoring workspace keeps its navigation visible across screen sizes", async ({ page }) => {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { setupRequired: false } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "qa", displayName: "Browser QA", enabled: true } } });
    if (path === "/api/admin/overview") return route.fulfill({ json: { clients: [], deployments: [], assignments: [], entitlements: [], versions: [] } });
    if (path === "/api/auth/logout") return route.fulfill({ json: {} });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  await page.goto("/clients");
  await expect(page.getByRole("banner", { name: "Workspace header" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link")).toHaveCount(5);
  await expect(navigation.getByRole("link", { name: "Clients" })).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("link", { name: "Deployments" }).click();
  await expect(page).toHaveURL(/\/deployments$/);
  await expect(navigation.getByRole("link", { name: "Deployments" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Account menu for Browser QA" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});
