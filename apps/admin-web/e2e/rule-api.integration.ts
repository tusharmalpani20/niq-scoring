import { expect, test, type Page } from "@playwright/test";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";

async function signIn(page: Page) {
  await page.goto("/versions");
  await page.getByLabel("Email address", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-browser-test-only-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/versions");
}

async function createFinalDraft(page: Page, name: string) {
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  const creation = page.waitForResponse(response => response.url().endsWith("/api/admin/rules") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const response = await creation;
  expect(response.status()).toBe(201);
  return await response.json() as { id: string; revision: number; definition: FinalAssessmentDefinition };
}

test("real API final-profile draft, reopen, duplicate and protected deletion", async ({ page }, info) => {
  const name = `Final browser ${info.project.name} ${Date.now()}`;
  await signIn(page);
  await createFinalDraft(page, name);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText(/Temporary risk thresholds.*awaiting confirmation/)).toHaveCount(0);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Synthetic final-profile persistence check");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Synthetic final-profile persistence check");
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  await page.getByRole("button", { name: `Duplicate ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Synthetic final-profile persistence check");
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  for (const title of [`${name} copy`, name]) {
    await page.getByRole("button", { name: `Delete ${title}`, exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Audit history is retained.");
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  }
});

test("real API persists final scoring edits and rejects altered fixed fields", async ({ page }, info) => {
  const name = `Final fixed browser ${info.project.name} ${Date.now()}`;
  await signIn(page);
  const created = await createFinalDraft(page, name);
  await page.locator("#final-field-tumour_type").getByRole("button", { name: /options configured/ }).click();
  await page.getByLabel("Solid Tumour points", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const savedResponse = await page.request.get(`/api/admin/rules/${created.id}`);
  const saved = await savedResponse.json() as { revision: number; definition: FinalAssessmentDefinition };
  expect(saved.definition.formatVersion).toBe(2);
  expect(saved.definition.sections.flatMap(section => section.fields).every(field => !Object.hasOwn(field, "cap"))).toBe(true);
  const tumour = saved.definition.sections[0]!.fields[0]!;
  expect(tumour.kind === "multi_select" && tumour.scoring.points.find(point => point.optionId === "tumour_type_solid")?.points).toBe(4);
  const tampered = structuredClone(saved.definition);
  const tamperedTumour = tampered.sections[0]!.fields[0]!;
  if (tamperedTumour.kind !== "multi_select") throw new Error("template tumour field changed");
  tamperedTumour.options[0]!.label = "Caller-defined field";
  const rejected = await page.request.put(`/api/admin/rules/${created.id}`, { headers: { origin: new URL(page.url()).origin }, data: { revision: saved.revision, definition: tampered } });
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({ error: "FIXED_RULE_REQUIRED" });
});
