import { expect, test } from "@playwright/test";

test("scoring workspace keeps its navigation visible across screen sizes", async ({ page, isMobile }) => {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { setupRequired: false, developmentToolsEnabled: true } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "qa", displayName: "Browser QA", enabled: true } } });
    if (path === "/api/admin/overview") return route.fulfill({ json: { clients: [], deployments: [], assignments: [], entitlements: [], versions: [] } });
    if (path === "/api/auth/logout") return route.fulfill({ json: {} });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  await page.goto("/clients");
  await expect(page.getByRole("banner", { name: "Workspace header" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link")).toHaveCount(7);
  await expect(navigation.getByRole("link", { name: "Clients" })).toHaveAttribute("aria-current", "page");
  const deployments = navigation.getByRole("link", { name: "Deployments", exact: true });
  await deployments.click();
  await expect(page).toHaveURL(/\/deployments$/);
  await expect(deployments).toHaveAttribute("aria-current", "page");
  const labelInset = () => deployments.locator("span").evaluate(async label => {
    await document.fonts.ready;
    const text = document.createRange();
    text.selectNodeContents(label);
    const { left, right } = text.getBoundingClientRect();
    const pill = label.parentElement!.getBoundingClientRect();
    return Math.min(left - pill.left, pill.right - right);
  });
  expect(await labelInset()).toBeGreaterThanOrEqual(4);
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await labelInset()).toBeGreaterThanOrEqual(1.5);
    await expect(navigation).toBeInViewport({ ratio: 1 });
  }
  await page.getByRole("button", { name: "Account menu for Browser QA" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("deployment records fit as cards on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only");
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { setupRequired: false } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "qa", displayName: "Browser QA", enabled: true } } });
    if (path === "/api/admin/deployments") return route.fulfill({ json: { items: [{ id: "deployment-1", clientId: "client-1", clientName: "North Clinic", name: "Production", displayLabel: "Production", environment: "production", hostingType: "NIQ_HOSTED", enabled: true, ruleLabel: "No rule", assignment: null, entitlements: [] }], total: 1, page: 1, pageSize: 10, pageCount: 1 } });
    if (path === "/api/admin/overview") return route.fulfill({ json: {
      clients: [{ id: "client-1", name: "North Clinic", enabled: true }],
      deployments: [{ id: "deployment-1", clientId: "client-1", name: "Production", environment: "production", hostingType: "NIQ_HOSTED", enabled: true }],
      assignments: [], entitlements: [], versions: [],
    } });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  await page.goto("/deployments");
  const record = page.getByRole("row", { name: /North Clinic/ });
  await expect(record).toBeVisible();
  await expect(record.getByRole("link", { name: "Production" })).toBeVisible();
  await expect(record.getByRole("button", { name: /Edit North Clinic Production deployment/ })).toBeVisible();
  const bounds = await record.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});
