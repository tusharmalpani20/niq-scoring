import { test, expect } from "@playwright/test";

test("client opens a detail page with usage and its deployments", async ({ page }) => {
  let credentialRevoked = false;
  let unusedTokenRevoked = false;
  let tokenListFailuresRemaining = 2;
  let failNextTokenRefresh = false;
  let failFirstRevoke = true;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admin/deployments/d1/activation-tokens/unused1" && route.request().method() === "DELETE") {
      unusedTokenRevoked = true;
      return route.fulfill({ json: { revoked: true } });
    }
    if (path === "/api/admin/deployments/d1/activation-tokens/used12/credential" && route.request().method() === "DELETE") {
      if (failFirstRevoke) {
        failFirstRevoke = false;
        return route.fulfill({ status: 503, json: { error: "INTERNAL_ERROR" } });
      }
      credentialRevoked = true;
      failNextTokenRefresh = true;
      return route.fulfill({ json: { revoked: true } });
    }
    if (path === "/api/auth/status") return route.fulfill({ json: { setupRequired: false } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "qa", displayName: "Browser QA", enabled: true } } });
    if (path === "/api/admin/overview") return route.fulfill({ json: {
      clients: [{ id: "c1", name: "Apollo", enabled: true }],
      deployments: [{ id: "d1", clientId: "c1", name: "Apollo Production", environment: "production", hostingType: "NIQ_HOSTED", enabled: true }],
      entitlements: [], assignments: [{ deploymentId: "d1", mode: "LATEST_APPROVED" }], versions: [{ id: "v1", version: "TEST-5", lifecycle: "ACTIVE", clinicalUsePermitted: true, isDefault: true }],
    } });
    if (path === "/api/admin/usage/rules") return route.fulfill({ json: { rules: new URL(route.request().url()).searchParams.has("clientId")
      ? [{ ruleVersionId: "r1", name: "Default (TEST-5)", count: 18 }]
      : [{ ruleVersionId: "r1", name: "Default (TEST-5)", count: 12 }, { ruleVersionId: "r2", name: "Previous rule", count: 6 }],
    } });
    if (path === "/api/admin/clients/c1/usage") return route.fulfill({ json: { deployments: [{ deploymentId: "d1", assessments: 18, vitalIq: 7, monthly: [
      { month: "2026-04", assessments: 2, vitalIq: 1 }, { month: "2026-05", assessments: 3, vitalIq: 1 },
      { month: "2026-06", assessments: 4, vitalIq: 2 }, { month: "2026-07", assessments: 2, vitalIq: 1 },
      { month: "2026-08", assessments: 3, vitalIq: 1 }, { month: "2026-09", assessments: 4, vitalIq: 1 },
    ] }] } });
    if (path === "/api/admin/deployments/d1/activation-tokens" && failNextTokenRefresh) {
      failNextTokenRefresh = false;
      return route.fulfill({ status: 503, json: { error: "INTERNAL_ERROR" } });
    }
    if (path === "/api/admin/deployments/d1/activation-tokens" && tokenListFailuresRemaining > 0) {
      tokenListFailuresRemaining--;
      return route.fulfill({ status: 503, json: { error: "INTERNAL_ERROR" } });
    }
    if (path === "/api/admin/deployments/d1/activation-tokens") return route.fulfill({ json: { tokens: [
      { id: "unused1", createdAt: "2026-09-14T00:00:00Z", expiresAt: null, status: unusedTokenRevoked ? "Revoked" : "Unused", canCopy: !unusedTokenRevoked, credentialStatus: null },
      { id: "used12", createdAt: "2026-09-14T00:00:00Z", expiresAt: null, status: "Used", canCopy: false, credentialStatus: credentialRevoked ? "Revoked" : "Active" },
      { id: "legacy1", createdAt: "2026-09-14T00:00:00Z", expiresAt: null, status: "Used", canCopy: false, credentialStatus: null },
      { id: "oldkey1", createdAt: "2026-09-14T00:00:00Z", expiresAt: null, status: "Used", canCopy: false, credentialStatus: "Expired" },
      { id: "revoked1", createdAt: "2026-09-14T00:00:00Z", expiresAt: null, status: "Revoked", canCopy: false, credentialStatus: null },
      { id: "expired1", createdAt: "2026-09-14T00:00:00Z", expiresAt: "2026-09-15T00:00:00Z", status: "Expired", canCopy: false, credentialStatus: null },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `history${index}`, createdAt: "2026-09-13T00:00:00Z", expiresAt: null, status: "Revoked", canCopy: false, credentialStatus: null })),
    ].slice(0, unusedTokenRevoked ? 6 : undefined) } });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "Assessments by rule" })).toBeVisible();
  await expect(page.locator(".recharts-surface")).toBeVisible();
  await page.getByRole("link", { name: /View clients/ }).click();
  await page.getByRole("link", { name: "Apollo", exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/c1$/);
  await expect(page.getByRole("heading", { name: "Apollo" })).toBeVisible();
  await expect(page.getByText("Assessments scored")).toBeVisible();
  await expect(page.getByText("18", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assessments by rule" })).toBeVisible();
  await expect(page.locator(".recharts-surface")).toHaveCount(2);
  await page.getByRole("tab", { name: /Deployments/ }).click();
  await expect(page.getByRole("link", { name: "Production" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Assessments · all time" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Vital IQ · all time" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Production/ }).getByText("Default (TEST-5)")).toBeVisible();
  await expect(page.getByRole("row", { name: /Production/ }).getByText("Enabled")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Client deployments pagination" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit production deployment" })).toBeVisible();
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
  await expect(page.getByText("Could not load tokens.")).toBeVisible();
  await expect(page.getByText("No tokens yet.")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Create token" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Access" })).toBeVisible();
  const tokenPagination = page.getByRole("navigation", { name: "Activation tokens pagination" });
  await expect(tokenPagination).toContainText("Page 1 of 2");
  await expect(tokenPagination).toContainText("12 total");
  await expect(tokenPagination.getByRole("button", { name: "Previous" })).toBeDisabled();
  await tokenPagination.getByRole("button", { name: "Next" }).click();
  await expect(tokenPagination).toContainText("Page 2 of 2");
  await expect(page.getByRole("row", { name: /story5/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /nused1/ })).toHaveCount(0);
  await tokenPagination.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("row", { name: /nused1/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Unused/ }).getByRole("button", { name: "Revoke token" })).toBeVisible();
  await expect(page.getByRole("row", { name: /voked1/ }).getByLabel("No actions available")).toBeVisible();
  await expect(page.getByRole("row", { name: /egacy1/ }).getByText("Unknown")).toBeVisible();
  await expect(page.getByRole("row", { name: /egacy1/ }).getByText("Unavailable")).toBeVisible();
  await expect(page.getByText("We cannot safely revoke one credential from its token row.")).toBeVisible();
  await expect(page.getByRole("row", { name: /ldkey1/ }).getByText("Expired")).toBeVisible();
  await expect(page.getByRole("row", { name: /ldkey1/ }).getByLabel("No actions available")).toBeVisible();
  await page.getByRole("row", { name: /nused1/ }).getByRole("button", { name: "Revoke token" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("can no longer be used to activate a deployment.");
  await expect(page.getByRole("alertdialog").getByRole("button", { name: "Revoke token" })).toHaveAttribute("data-variant", "destructive");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  expect(unusedTokenRevoked).toBe(false);
  await page.getByRole("row", { name: /nused1/ }).getByRole("button", { name: "Revoke token" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke token" }).click();
  await expect(page.getByRole("row", { name: /nused1/ }).getByText("Revoked")).toBeVisible();
  await expect(tokenPagination).toHaveCount(0);
  expect(unusedTokenRevoked).toBe(true);
  await page.getByRole("button", { name: "Revoke access for token NIQ …used12" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Future requests using the credential issued by token");
  await expect(page.getByRole("alertdialog").getByRole("button", { name: "Revoke access" })).toHaveAttribute("data-variant", "destructive");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  expect(credentialRevoked).toBe(false);
  await page.getByRole("button", { name: "Revoke access for token NIQ …used12" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("The service could not complete the request.");
  expect(credentialRevoked).toBe(false);
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByRole("row", { name: /used12/ }).getByRole("cell").nth(4).getByText("Revoked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke access for token NIQ …used12" })).toHaveCount(0);
  await expect(page.getByText("Access was revoked, but the token list could not be refreshed.")).toBeVisible();
  expect(credentialRevoked).toBe(true);
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByText("A new token replaces any unused token.")).toBeVisible();
  await page.getByRole("region", { name: "Activation tokens" }).getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
