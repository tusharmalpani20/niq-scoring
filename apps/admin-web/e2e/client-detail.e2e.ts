import { test, expect } from "@playwright/test";

test("client opens a detail page with usage and its deployments", async ({ page }) => {
  let credentialRevoked = false;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admin/deployments/d1/activation-tokens/used12/credential" && route.request().method() === "DELETE") {
      credentialRevoked = true;
      return route.fulfill({ json: { revoked: true } });
    }
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
    if (path === "/api/admin/deployments/d1/activation-tokens") return route.fulfill({ json: { tokens: [
      { id: "unused1", createdAt: "2026-09-14T00:00:00Z", expiresAt: null, status: "Unused", canCopy: true, credentialStatus: null },
      { id: "used12", createdAt: "2026-09-14T00:00:00Z", expiresAt: null, status: "Used", canCopy: false, credentialStatus: credentialRevoked ? "Revoked" : "Active" },
      { id: "legacy1", createdAt: "2026-09-14T00:00:00Z", expiresAt: null, status: "Used", canCopy: false, credentialStatus: null },
      { id: "revoked1", createdAt: "2026-09-14T00:00:00Z", expiresAt: null, status: "Revoked", canCopy: false, credentialStatus: null },
      { id: "expired1", createdAt: "2026-09-14T00:00:00Z", expiresAt: "2026-09-15T00:00:00Z", status: "Expired", canCopy: false, credentialStatus: null },
    ] } });
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
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("link", { name: "Production" }).click();
  await expect(page).toHaveURL(/\/deployments\/d1$/);
  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  await expect(page.locator(".recharts-surface")).toBeVisible();
  await page.getByRole("tab", { name: "Settings & limits" }).click();
  await expect(page.getByRole("heading", { name: "Settings & limits" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Rules & limits" })).toBeVisible();
  await expect(page.getByText("NIQ hosted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit deployment" }).click();
  await expect(page.getByRole("dialog")).toContainText("Apollo");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("tab", { name: "Tokens" }).click();
  await expect(page.getByRole("region", { name: "Activation tokens" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create token" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Unused/ }).getByRole("button", { name: "Revoke token" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Revoked/ }).getByLabel("No actions available")).toBeVisible();
  await expect(page.getByRole("row", { name: /egacy1/ }).getByText("Access link unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Revoke access for token NIQ …used12" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Other installations stay connected");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  expect(credentialRevoked).toBe(false);
  await page.getByRole("button", { name: "Revoke access for token NIQ …used12" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByRole("row", { name: /used12/ }).getByText("Access revoked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke access for token NIQ …used12" })).toHaveCount(0);
  expect(credentialRevoked).toBe(true);
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByText("A new token replaces any unused token.")).toBeVisible();
  await page.getByRole("region", { name: "Activation tokens" }).getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
