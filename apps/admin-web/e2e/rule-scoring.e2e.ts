import { expect, test } from "@playwright/test";
import { createSpreadsheetTemplate } from "@niq-scoring/contracts/rule-template";
import { mockConsole, startDraft } from "./rule-fixture";

test("Excel option points and caps persist without changing questionnaire structure", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const original = structuredClone(state.getRecord()!.definition);
  await expect(page.getByLabel("Category name", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Risk categories", exact: true }).click();
  await page.getByLabel("What it means", { exact: true }).first().fill("Updated risk interpretation");
  await expect(page.getByText("0 to 15, including both", { exact: true })).toBeVisible();
  await page.getByLabel("To score rule", { exact: true }).first().click();
  await page.getByRole("option", { name: "Less than", exact: true }).click();
  await expect(page.getByText("At least 0 and below 15", { exact: true })).toBeVisible();
  await page.getByLabel("To score rule", { exact: true }).first().click();
  await page.getByRole("option", { name: "Up to and including", exact: true }).click();

  await page.getByRole("tab", { name: "Scoring", exact: true }).click();

  for (const name of ["Add domain", "Add option scoring", "Add conditional scoring", "Remove scoring rule", "Synchronize answer options"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await page.locator("#rule-field-tumour_type").getByRole("button", { name: /configured/ }).click();
  const tumour = page.locator("#rule-scoring-tumour_type_score");
  const diseaseGroup = page.getByRole("row", { name: "Disease group", exact: true });
  await diseaseGroup.getByText("0 fields selected", { exact: true }).click();
  const tumourLabel = original.scoring.find(rule => rule.id === "tumour_type_score")!.label;
  await diseaseGroup.getByRole("checkbox", { name: tumourLabel, exact: true }).check();
  await expect(diseaseGroup.getByRole("button", { name: "Remove group" })).toBeDisabled();
  const clinicalGroup = page.getByRole("row", { name: "Clinical group", exact: true });
  await clinicalGroup.getByText("0 fields selected", { exact: true }).click();
  await expect(clinicalGroup.getByRole("checkbox", { name: `${tumourLabel} — Disease`, exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await page.getByLabel("New group group name", { exact: true }).fill("Additional scores");
  await page.getByLabel("Additional scores cap", { exact: true }).fill("3");
  await page.getByLabel("Solid tumour", { exact: true }).fill("4");

  await page.getByLabel("Disease cap", { exact: true }).fill("8");
  await page.getByLabel("Total cap", { exact: true }).fill("40");
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Scoring edits survive tab switches");
  await page.getByRole("tab", { name: "Interventions", exact: true }).click();
  await expect(page.getByText(/N\/A.*not finalized/i)).toBeVisible();
  await page.getByRole("tab", { name: "Scoring", exact: true }).click();
  await expect(page.getByLabel("Solid tumour", { exact: true })).toHaveValue("4");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/^Draft saved\./)).toBeVisible();
  const saved = state.getRecord()!.definition;
  expect(saved.classifications[0]!.interpretation).toBe("Updated risk interpretation");
  expect(saved.classifications.map(({ min, max, minInclusive, maxInclusive }) => ({ min, max, minInclusive, maxInclusive }))).toEqual(original.classifications.map(({ min, max, minInclusive, maxInclusive }) => ({ min, max, minInclusive, maxInclusive })));
  expect(saved.sections).toEqual(original.sections);
  expect(saved.calculations).toEqual(original.calculations);
  const tumourRule = saved.scoring.find(rule => rule.kind === "options" && rule.questionId === "tumour_type");
  expect(tumourRule).toMatchObject({ domainId: "disease", points: expect.arrayContaining([{ optionId: "tumour_type_solid", points: 4 }]) });
  expect(saved.domains[0]!.cap).toBe(8);
  expect(saved.total.cap).toBe(40);
  expect(saved.domains).toContainEqual(expect.objectContaining({ label: "Additional scores", cap: 3 }));
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  await page.getByRole("button", { name: "Synthetic browser draft", exact: true }).click();
  await page.locator("#rule-field-tumour_type").getByRole("button", { name: /configured/ }).click();
  await expect(page.getByLabel("Solid tumour", { exact: true })).toHaveValue("4");
  await expect(page.getByLabel("Total cap", { exact: true })).toHaveValue("40");
});

test("approved history retains fixed content and read-only scoring", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  state.freezeRecord();
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  await page.getByRole("button", { name: "Synthetic browser draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
  await page.locator("#rule-field-tumour_type").getByRole("button", { name: /configured/ }).click();
  await expect(page.getByLabel("Solid tumour", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Total cap", { exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Risk categories", exact: true }).click();
  await expect(page.getByLabel("Category name", { exact: true }).first()).toBeDisabled();
  await expect(page.getByLabel("To score rule", { exact: true }).first()).toBeDisabled();
  expect(state.getRecord()!.definition.sections).toEqual(createSpreadsheetTemplate("Reference").sections);
});

test("unspecified option scores stay blank until configured", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.locator("#rule-field-treatment_status").getByRole("button", { name: /configured/ }).click();
  const option = page.getByLabel("Palliative Care", { exact: true });
  await expect(option).toHaveValue("");
  const original = state.getRecord()!.definition.scoring.find(rule => rule.kind === "options" && rule.questionId === "treatment_status");
  expect(original).toBeDefined();
  expect(original!.kind === "options" && original!.points.some(point => point.optionId === "treatment_status_palliative")).toBe(false);
  await option.fill("0");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/^Draft saved\./)).toBeVisible();
  const configured = state.getRecord()!.definition.scoring.find(rule => rule.kind === "options" && rule.questionId === "treatment_status");
  expect(configured).toMatchObject({ points: expect.arrayContaining([{ optionId: "treatment_status_palliative", points: 0 }]) });
  await option.fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/^Draft saved\./)).toBeVisible();
  const cleared = state.getRecord()!.definition.scoring.find(rule => rule.kind === "options" && rule.questionId === "treatment_status");
  expect(cleared!.kind === "options" && cleared!.points.some(point => point.optionId === "treatment_status_palliative")).toBe(false);
});

test("range editing persists boundaries and points while retaining fixed fields", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const row = page.locator("#rule-field-creatinine");
  await expect(row).toContainText("2 ranges configured");
  await row.getByRole("button", { name: /ranges configured/ }).click();
  const editor = page.locator("#rule-scoring-creatinine_score");
  await editor.getByLabel("Maximum (blank = unbounded)", { exact: true }).first().fill("1.5");
  await editor.getByLabel("Include maximum", { exact: true }).first().check();
  await editor.getByLabel("Minimum (blank = unbounded)", { exact: true }).nth(1).fill("1.5");
  await editor.getByLabel("Range points", { exact: true }).first().fill("3");
  await editor.getByRole("button", { name: "Add range", exact: true }).click();
  await expect(row).toContainText("3 ranges configured");
  await editor.getByRole("button", { name: "Remove range", exact: true }).last().click();
  await expect(row).toContainText("2 ranges configured");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/^Draft saved\./)).toBeVisible();
  const rule = state.getRecord()!.definition.scoring.find(rule => rule.id === "creatinine_score");
  expect(rule).toMatchObject({ bands: [
    expect.objectContaining({ max: 1.5, maxInclusive: true, points: 3 }),
    expect.objectContaining({ min: 1.5 }),
  ] });
  await page.reload();
  await row.getByRole("button", { name: /ranges configured/ }).click();
  await expect(editor.getByLabel("Range points", { exact: true }).first()).toHaveValue("3");
});
