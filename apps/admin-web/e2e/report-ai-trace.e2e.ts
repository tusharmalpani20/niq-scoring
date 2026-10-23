import { expect, test } from "@playwright/test";

test("agent trace is fetched only on demand, displays messages as text, and can refresh or close", async ({ page }) => {
  let traceRequests = 0;
  const run = { id: "trace-run", clientId: "client", deploymentId: "deployment", ruleVersionId: "rule", status: "READY", model: "test-model", promptVersion: "prompt-test", schemaVersion: 4, errorCode: null, createdAt: "2026-10-15T10:00:00Z", completedAt: "2026-10-15T10:01:00Z", calls: [] };
  const hostile = '<img src=x onerror="window.traceExecuted=true">';
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { setupRequired: false, developmentToolsEnabled: true } });
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "qa", displayName: "Browser QA", enabled: true } } });
    if (path === "/api/admin/report-ai/runs") return route.fulfill({ json: { items: [run], total: 1, page: 1, pageSize: 20 } });
    if (path === "/api/admin/report-ai/runs/trace-run/trace") {
      traceRequests++;
      return route.fulfill({ json: { run, retentionDays: 30, calls: [{ id: "call", attemptId: "attempt", sequence: 1, step: "reviewer", system: hostile, user: "assessment-derived task", schema: { type: "object" }, response: { approved: false, reason: "SOURCE_CONFLICT" }, usage: { model: "test-model" }, errorCode: null, createdAt: run.createdAt, completedAt: run.completedAt, expiresAt: "2026-11-14T10:00:00Z" }], events: [{ id: "event", attemptId: "attempt", stage: "fallback_selected", payload: { field: "nutritionAdvice", reason: "SOURCE_CONFLICT" }, createdAt: run.completedAt, expiresAt: "2026-11-14T10:00:00Z" }] } });
    }
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  await page.goto("/report-ai-usage");
  await expect(page.getByRole("button", { name: "View agent trace" })).toBeVisible();
  expect(traceRequests).toBe(0);
  await page.getByRole("button", { name: "View agent trace" }).click();
  await page.getByText("Call 1 · reviewer · completed", { exact: true }).click();
  await page.getByText("System prompt", { exact: true }).click();
  await expect(page.locator("pre").filter({ hasText: hostile })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(traceRequests).toBe(1);
  await page.getByRole("button", { name: "Refresh agent trace" }).click();
  await expect.poll(() => traceRequests).toBe(2);
  await page.getByRole("button", { name: "Close agent trace" }).click();
  await expect(page.locator("pre")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

for (const developmentToolsEnabled of [false, undefined]) {
  test(`AI usage navigation and direct page access are disabled when capability is ${developmentToolsEnabled}`, async ({page}) => {
    let usageRequests=0;
    await page.route("**/api/**",route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==="/api/auth/status")return route.fulfill({json:{setupRequired:false,developmentToolsEnabled}});
      if(path==="/api/auth/session")return route.fulfill({json:{user:{id:"qa",displayName:"QA",enabled:true}}});
      if(path.startsWith("/api/admin/report-ai/runs"))usageRequests++;
      return route.fulfill({json:{}});
    });
    await page.goto("/report-ai-usage");
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole("link",{name:"AI usage",exact:true})).toHaveCount(0);
    await expect(page.getByRole("region",{name:"Report AI usage"})).toHaveCount(0);
    expect(usageRequests).toBe(0);
  });
}
