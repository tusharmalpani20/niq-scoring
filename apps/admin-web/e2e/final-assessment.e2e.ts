import { expect, test } from "@playwright/test";
import { mockFinalConsole, startFinalDraft } from "./final-assessment-fixture";

test("final assessment editor follows the audited section layout", async ({ page }, info) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await expect(page.getByText(/Temporary risk thresholds/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Field name", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Type", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Scoring", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Cap", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /fixed options/ }).first().click();
  await expect(page.getByLabel("Solid Tumour points", { exact: true })).toBeVisible();
  await page.getByLabel("Solid Tumour points", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved. Temporary risk thresholds remain blocked from clinical use.", { exact: true })).toBeVisible();
  expect(state.getRecord()!.definition.sections[0]!.fields[0]!.kind).toBe("multi_select");
  const tumour = state.getRecord()!.definition.sections[0]!.fields[0]!;
  expect(tumour.kind === "multi_select" && tumour.scoring.points.find(point => point.optionId === "tumour_type_solid")?.points).toBe(4);
  await page.screenshot({ path: info.outputPath("final-assessment-desktop.png"), animations: "disabled", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("final assessment replaces desktop section navigation with a mobile select", async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 0) > 700, "Mobile navigation assertion");
  await mockFinalConsole(page);
  await startFinalDraft(page);
  await expect(page.getByLabel("Assessment section", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Scoring sections", exact: true })).toBeHidden();
  await page.getByLabel("Assessment section", { exact: true }).selectOption("dietary_details");
  await expect(page.getByRole("heading", { name: "Dietary details", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("final-assessment-mobile.png"), animations: "disabled", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("final assessment save conflicts preserve edits", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Unsaved final profile change");
  state.saveError = "RULE_REVISION_CONFLICT";
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/This version changed in another session/)).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved final profile change");
});
