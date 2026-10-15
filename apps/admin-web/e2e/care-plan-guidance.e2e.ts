import { expect, test } from "@playwright/test";
import { mockFinalConsole, startFinalDraft } from "./final-assessment-fixture";

test("care plan rules use risk labels, allow treatment guidance and save edits", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Care plan rules", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Care plan sections" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Drug-class by status 48/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Treatment guidance 3/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Products & doses 12/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Co-morbidity diet 5/ })).toBeVisible();
  await expect(page.getByLabel("Nutritional status for Moderate Risk")).toContainText("Moderately nourished");
  await page.getByLabel("Nutritional status for Moderate Risk").click();
  await page.getByRole("option", { name: "Select nutritional status" }).click();
  await expect(page.getByText("Choose a nutritional status for every risk category before checking this rule version.")).toBeVisible();
  await page.getByLabel("Nutritional status for Moderate Risk").click();
  await page.getByRole("option", { name: "Moderately nourished" }).click();
  await expect(page.getByText("Choose a nutritional status for every risk category before checking this rule version.")).toHaveCount(0);
  await expect(page.getByLabel("Ask the clinician to choose")).toHaveCount(0);
  await page.getByRole("button", { name: /Treatment guidance 3/ }).click();
  await expect(page.getByText("Radiation Therapy · Moderately nourished")).toBeVisible();
  await page.getByRole("button", { name: "Add rule" }).click();
  const treatmentEditor = page.getByRole("dialog");
  await treatmentEditor.getByLabel("Treatment type").click();
  await page.getByRole("option", { name: "Immunotherapy" }).click();
  await treatmentEditor.getByLabel("Nutritional status").click();
  await page.getByRole("option", { name: "Moderately nourished" }).click();
  await treatmentEditor.getByLabel("Nutrition guidance").fill("Clinician-approved immunotherapy nutrition guidance.");
  await treatmentEditor.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("Immunotherapy · Moderately nourished")).toBeVisible();
  await page.getByRole("button", { name: /Products & doses 12/ }).click();
  await page.getByRole("button", { name: "Edit After surgery · Well nourished" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Liss WH preparation").fill("Clinician-reviewed preparation");
  await editor.getByRole("button", { name: "Save rule" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.getRecord()?.definition.carePlanGuidance?.surgicalOverlapPolicy).toBe("surgical_priority");
  expect(state.getRecord()?.definition.carePlanGuidance?.oncology.radiotherapy.find(row => row.treatmentTypeId === "current_cancer_treatment_immunotherapy")?.guidance)
    .toBe("Clinician-approved immunotherapy nutrition guidance.");
  expect(state.getRecord()?.definition.carePlanGuidance?.products.plans.find(row => row.id === "product_surgical_well_nourished")?.items?.[0]?.preparation)
    .toBe("Clinician-reviewed preparation");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
