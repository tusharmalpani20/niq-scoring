import { expect, test } from "@playwright/test";
import { mockFinalConsole, startFinalDraft } from "./final-assessment-fixture";

test("care plan rules use risk labels, show workbook rows and save edits", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Care plan rules", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Care plan sections" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Drug-class by status 48/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Radiotherapy 3/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Products & doses 12/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Co-morbidity diet 5/ })).toBeVisible();
  await expect(page.getByLabel("Nutritional status for Moderate Risk")).toContainText("Moderately nourished");
  await page.getByLabel("Ask the clinician to choose").check();
  await page.getByRole("button", { name: /Products & doses 12/ }).click();
  await page.getByRole("button", { name: "Edit After surgery · Well nourished" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Dose", { exact: true }).fill("Clinician-reviewed dose");
  await editor.getByRole("button", { name: "Save rule" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.getRecord()?.definition.carePlanGuidance?.surgicalOverlapPolicy).toBe("clinician_choice");
  expect(state.getRecord()?.definition.carePlanGuidance?.products.plans.find(row => row.id === "product_surgical_well_nourished")?.dose)
    .toBe("Clinician-reviewed dose");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
