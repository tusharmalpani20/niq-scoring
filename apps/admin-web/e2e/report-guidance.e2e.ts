import { expect, test } from "@playwright/test";
import { mockFinalConsole, startFinalDraft } from "./final-assessment-fixture";

test("drug-class report guidance uses class and treatment without symptom matching", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  const original = state.getRecord()!.definition.reportGuidance!.toxicity.map(row => ({
    id: row.id,
    expectedToxicity: row.expectedToxicity,
    match: row.match,
  }));

  await page.getByRole("tab", { name: "Report guidance" }).click();
  await page.getByRole("button", { name: /Drug-class guidance 136/ }).click();
  await expect(page.getByRole("columnheader", { name: "Drug class" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Treatment" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Nutrition intervention" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "When used" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Expected toxicity" })).toHaveCount(0);
  await expect(page.getByLabel("Filter guidance treatment")).toBeVisible();

  await page.getByRole("button", { name: /Edit guidance for/ }).first().click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByLabel("Expected toxicity")).toHaveCount(0);
  await expect(editor.getByText("When should this guidance apply?")).toHaveCount(0);
  await editor.getByLabel("Nutrition intervention").fill("Provide clinician-reviewed food and fluid guidance during treatment.");
  await editor.getByRole("button", { name: "Save changes" }).click();

  await page.getByRole("button", { name: "Add intervention" }).click();
  await editor.getByLabel("Drug class").click();
  await page.getByRole("option", { name: "Taxanes" }).click();
  await editor.getByLabel("Treatment").click();
  await page.getByRole("option", { name: "Chemotherapy (Cytotoxic)" }).click();
  await editor.getByLabel("Nutrition intervention").fill("Add a new class and treatment nutrition plan after review.");
  await editor.getByRole("button", { name: "Add intervention" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();

  const saved = state.getRecord()!.definition.reportGuidance!.toxicity;
  expect(saved).toHaveLength(original.length + 1);
  for (const row of original) {
    const result = saved.find(item => item.id === row.id)!;
    expect(result.expectedToxicity).toBe(row.expectedToxicity);
    expect(result.match).toEqual(row.match);
  }
  expect(saved.at(-1)).toMatchObject({
    expectedToxicity: "",
    nutritionalInterventions: "Add a new class and treatment nutrition plan after review.",
  });
  expect(saved.at(-1)?.match).toBeUndefined();
});
