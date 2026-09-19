import { test, expect } from "@playwright/test";

test("deployments show and filter resolved versions and explain the default", async ({ page }) => {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { setupRequired: false } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "qa", displayName: "Browser QA", enabled: true } } });
    if (path === "/api/admin/overview") return route.fulfill({ json: {
      clients: [{ id: "c1", name: "Apollo", enabled: true }, { id: "c2", name: "Beta", enabled: true }],
      deployments: [
        { id: "d1", clientId: "c1", name: "Apollo", environment: "production", hostingType: "NIQ_HOSTED", enabled: true },
        { id: "d2", clientId: "c2", name: "Beta", environment: "test", hostingType: "NIQ_HOSTED", enabled: true },
      ],
      assignments: [{ deploymentId: "d1", mode: "LATEST_APPROVED" }, { deploymentId: "d2", mode: "PINNED", scoringRuleVersionId: "v1" }],
      entitlements: [],
      versions: [
        { id: "v1", version: "Rules 1", lifecycle: "ACTIVE", clinicalUsePermitted: true },
        { id: "v2", version: "Rules 2", lifecycle: "ACTIVE", clinicalUsePermitted: true, isDefault: true },
      ],
    } });
    if (path.includes("/deletion")) return route.fulfill({ json: { deletable: false } });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  await page.goto("/deployments");
  const table = page.getByRole("table");
  await expect(table.getByText("Default (Rules 2)", { exact: true })).toBeVisible();
  await expect(table.getByText("Rules 1", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Rule versions", exact: true }).click();
  await page.getByRole("option", { name: "Rules 2", exact: true }).click();
  await expect(table.getByRole("button", { name: "Apollo", exact: true })).toBeVisible();
  await expect(table.getByRole("button", { name: "Beta", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(table.getByRole("button", { name: "Beta", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Apollo production deployment", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("combobox", { name: "Rule version", exact: true })).toContainText("Default (Rules 2)");
  await expect(page.getByRole("dialog")).toContainText("assessments already started keep their original rules");
});
