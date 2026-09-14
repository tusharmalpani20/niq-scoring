import { expect, test } from "@playwright/test";
import { createSpreadsheetTemplate } from "@niq-scoring/contracts/rule-template";
import { mockConsole, startDraft } from "./rule-fixture";

test("Excel option points and caps persist without changing questionnaire structure", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const original = structuredClone(state.getRecord()!.definition);
  await page.getByRole("tab", { name: "Scoring", exact: true }).click();
  for (const name of ["Add domain", "Add option scoring", "Add conditional scoring", "Remove scoring rule", "Synchronize answer options"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  const tumour = page.locator("#rule-scoring-tumour_type_score");
  await tumour.getByRole("combobox", { name: "Domain", exact: true }).click();
  await page.getByRole("option", { name: "Disease", exact: true }).click();
  await page.getByLabel("Solid tumour", { exact: true }).fill("4");
  await tumour.getByLabel("Component cap", { exact: true }).fill("3");
  await page.getByLabel("Domain cap", { exact: true }).first().fill("8");
  await page.getByLabel("Total cap", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const saved = state.getRecord()!.definition;
  expect(saved.sections).toEqual(original.sections);
  expect(saved.calculations).toEqual(original.calculations);
  const tumourRule = saved.scoring.find(rule => rule.kind === "options" && rule.questionId === "tumour_type");
  expect(tumourRule).toMatchObject({ domainId: "disease", cap: 3, points: expect.arrayContaining([{ optionId: "tumour_type_solid", points: 4 }]) });
  expect(saved.domains[0]!.cap).toBe(8);
  expect(saved.total.cap).toBe(40);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Synthetic browser draft", exact: true }).click();
  await page.getByRole("tab", { name: "Scoring", exact: true }).click();
  await expect(page.getByLabel("Solid tumour", { exact: true })).toHaveValue("4");
  await expect(page.getByLabel("Total cap", { exact: true })).toHaveValue("40");
});

test("unresolved Excel decisions block validation instead of implying approval", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByText("Source decisions", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Validation", exact: true }).click();
  await page.getByRole("button", { name: "Validate version", exact: true }).click();
  await expect(page.getByRole("list", { name: "Validation issues" })).toBeVisible();
  expect(state.getRecord()!.lifecycle).toBe("DRAFT");
  await expect(page.getByRole("button", { name: "Approve version", exact: true })).toHaveCount(0);
});

test("approved history retains fixed content and read-only scoring", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  state.freezeRecord();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Synthetic browser draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Scoring", exact: true }).click();
  await expect(page.getByLabel("Solid tumour", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Total cap", { exact: true })).toBeDisabled();
  expect(state.getRecord()!.definition.sections).toEqual(createSpreadsheetTemplate("Reference").sections);
});

test("unspecified option scores stay blank until configured", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Scoring", exact: true }).click();
  const option = page.getByLabel("Palliative Care", { exact: true });
  await expect(option).toHaveValue("");
  const original = state.getRecord()!.definition.scoring.find(rule => rule.kind === "options" && rule.questionId === "treatment_status");
  expect(original).toBeDefined();
  expect(original!.kind === "options" && original!.points.some(point => point.optionId === "treatment_status_palliative")).toBe(false);
  await option.fill("0");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const configured = state.getRecord()!.definition.scoring.find(rule => rule.kind === "options" && rule.questionId === "treatment_status");
  expect(configured).toMatchObject({ points: expect.arrayContaining([{ optionId: "treatment_status_palliative", points: 0 }]) });
  await option.fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const cleared = state.getRecord()!.definition.scoring.find(rule => rule.kind === "options" && rule.questionId === "treatment_status");
  expect(cleared!.kind === "options" && cleared!.points.some(point => point.optionId === "treatment_status_palliative")).toBe(false);
});
