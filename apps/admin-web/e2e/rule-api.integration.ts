import { expect, test } from "@playwright/test";
import type { EditableRule } from "../src/rules/rule-api";

test("real API login, spreadsheet draft, reopen, duplicate and protected deletion", async ({ page }, info) => {
  const name = `Synthetic browser ${info.project.name} ${Date.now()}`;
  // No page.route interception: requests use the production Hono routes,
  // authentication and validators with disposable in-memory persistence.
  await page.goto("/versions");
  await page.getByLabel("Email address", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-browser-test-only-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/versions");
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/versions\/[^/]+$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Synthetic browser persistence check");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/^Draft saved\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve version", exact: true })).toHaveCount(0);
  await expect(page.getByText(/not ready for use/)).toBeVisible();
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Synthetic browser persistence check");
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  await page.getByRole("button", { name: `Duplicate ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Synthetic browser persistence check");
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Copy-only change");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/^Draft saved\./)).toBeVisible();
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Synthetic browser persistence check");
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  for (const title of [`${name} copy`, name]) {
    await page.getByRole("button", { name: `Delete ${title}`, exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Audit history is retained.");
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  }
});

test("real API persists scoring edits and rejects altered fixed fields", async ({ page }, info) => {
  const name = `Synthetic fixed rules ${info.project.name} ${Date.now()}`;
  await page.goto("/versions");
  await page.getByLabel("Email address", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-browser-test-only-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/versions");
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await expect(page.getByLabel("Starting point", { exact: true })).toHaveCount(0);
  const creation = page.waitForResponse(response => response.url().endsWith("/api/admin/rules") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const response = await creation;
  expect(response.status()).toBe(201);
  const created = await response.json() as EditableRule;
  await page.locator("#rule-field-tumour_type").getByRole("button", { name: /configured/ }).click();
  await page.getByLabel("Solid tumour", { exact: true }).fill("4");
  await page.getByLabel("Total cap", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/^Draft saved\./)).toBeVisible();
  const savedResponse = await page.request.get(`/api/admin/rules/${created.id}`);
  const saved = await savedResponse.json() as EditableRule;
  expect(saved.definition.total.cap).toBe(40);
  expect(saved.definition.sections).toEqual(created.definition.sections);
  const tampered = structuredClone(saved.definition);
  tampered.sections[0]!.questions[0]!.label = "Caller-defined field";
  const rejected = await page.request.put(`/api/admin/rules/${created.id}`, { headers: { origin: new URL(page.url()).origin }, data: { revision: saved.revision, definition: tampered } });
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({ error: "FIXED_RULE_REQUIRED" });
  const reloaded = await (await page.request.get(`/api/admin/rules/${created.id}`)).json() as EditableRule;
  expect(reloaded.revision).toBe(saved.revision);
  expect(reloaded.definition.sections).toEqual(created.definition.sections);
});
