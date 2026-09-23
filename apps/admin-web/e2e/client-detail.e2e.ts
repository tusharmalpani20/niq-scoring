import { test, expect } from "@playwright/test";

test("client opens a detail page with usage and its deployments", async ({ page }) => {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { setupRequired: false } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "qa", displayName: "Browser QA", enabled: true } } });
    if (path === "/api/admin/overview") return route.fulfill({ json: {
      clients: [{ id: "c1", name: "Apollo", enabled: true }],
      deployments: [{ id: "d1", clientId: "c1", name: "Apollo Production", environment: "production", hostingType: "NIQ_HOSTED", enabled: true }],
      entitlements: [], assignments: [], versions: [],
    } });
    if (path === "/api/admin/clients/c1/usage") return route.fulfill({ json: { deployments: [{ deploymentId: "d1", assessments: 18, vitalIq: 7, monthly: [
      { month: "2026-04", assessments: 2, vitalIq: 1 }, { month: "2026-05", assessments: 3, vitalIq: 1 },
      { month: "2026-06", assessments: 4, vitalIq: 2 }, { month: "2026-07", assessments: 2, vitalIq: 1 },
      { month: "2026-08", assessments: 3, vitalIq: 1 }, { month: "2026-09", assessments: 4, vitalIq: 1 },
    ] }] } });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  await page.goto("/clients");
  await page.getByRole("link", { name: "Apollo", exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/c1$/);
  await expect(page.getByRole("heading", { name: "Apollo" })).toBeVisible();
  await expect(page.getByText("Assessments scored")).toBeVisible();
  await expect(page.getByText("18", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-surface")).toBeVisible();
  await page.getByRole("tab", { name: /Deployments/ }).click();
  await expect(page.getByRole("link", { name: "Production" })).toBeVisible();
  await page.getByRole("button", { name: "Create deployment" }).click();
  await expect(page.getByRole("dialog").getByRole("combobox", { name: "Client" })).toHaveText("Apollo");
});
