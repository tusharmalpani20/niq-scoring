import { test, expect } from "@playwright/test";

test("deployments show and filter resolved versions and explain the default", async ({ page }, testInfo) => {
  if (testInfo.project.name === "desktop") await page.setViewportSize({ width: 1065, height: 797 });
  let saved: Record<string, unknown> | undefined;
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
    if (path === "/api/admin/deployments/d1/configuration") {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { id: "d1" } });
    }
    if (path.includes("/deletion")) return route.fulfill({ json: { deletable: false } });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  await page.goto("/deployments");
  const table = page.getByRole("table");
  await expect(table.getByText("Default (Rules 2)", { exact: true })).toBeVisible();
  await expect(table.getByText("Rules 1", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Rules", exact: true }).click();
  await page.getByRole("option", { name: "Rules 2", exact: true }).click();
  await expect(table.getByRole("button", { name: "Apollo", exact: true })).toBeVisible();
  await expect(table.getByRole("button", { name: "Beta", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(table.getByRole("button", { name: "Beta", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Apollo production deployment", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("list", { name: "Editing progress" })).toHaveCount(0);
  await expect(dialog).toContainText("Apollo");
  await expect(dialog).toContainText("Production");
  await expect(dialog.getByRole("combobox", { name: "Client", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "Rule", exact: true })).toContainText("Default (Rules 2)");
  await expect(dialog).toContainText("assessments already started keep their original rules");
  await dialog.getByRole("combobox", { name: "Rule", exact: true }).click();
  await page.getByRole("option", { name: "Rules 1 (active)", exact: true }).click();
  await dialog.getByRole("switch", { name: "Assessments", exact: true }).click();
  await expect(dialog.locator("label").filter({ hasText: "Monthly assessments" })).toContainText("*");
  await dialog.getByRole("spinbutton", { name: "Monthly assessments", exact: true }).fill("");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toContainText("Enter a whole number from 0 to 2,147,483,647.");
  await dialog.getByRole("spinbutton", { name: "Monthly assessments", exact: true }).fill("125");
  await expect(dialog.getByRole("combobox", { name: "Rule", exact: true })).toContainText("Rules 1");
  await expect(dialog.getByRole("spinbutton", { name: "Monthly assessments", exact: true })).toHaveValue("125");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Your unsaved changes will be lost.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing", exact: true }).click();
  const save = dialog.getByRole("button", { name: "Save changes", exact: true });
  const bounds = await save.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThan(0);
  expect(bounds!.y + bounds!.height).toBeLessThan(page.viewportSize()!.height);
  await expect(save).toBeInViewport({ ratio: 1 });
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toMatchObject({ scoring: { enabled: true, monthlyLimit: 125 }, versionAssignment: { mode: "PINNED", scoringRuleVersionId: "v1" } });
  await page.getByRole("button", { name: "Create deployment", exact: true }).click();
  for (const field of ["clientId", "environment", "hostingType"]) {
    await expect(dialog.locator(`label[for="deployment-${field}"]`)).toContainText("*");
  }
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Client", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText("This field is required.")).toBeVisible();
  await dialog.getByRole("combobox", { name: "Client", exact: true }).click();
  await page.getByRole("option", { name: "Apollo", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("switch", { name: "Assessments", exact: true })).toBeVisible();
  await expect(dialog.locator('label[for="deployment-ruleVersion"]')).toContainText("*");
  await expect(dialog.getByRole("combobox", { name: "Rule", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog).toContainText("Default (Rules 2)");
  await expect(dialog.getByRole("combobox", { name: "Token expiry" })).toHaveText("No expiry");
});
