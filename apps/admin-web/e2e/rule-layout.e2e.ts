import { expect, test } from "@playwright/test";
import { blankRuleDefinition, questionSchema } from "@niq-scoring/contracts/rules";
import { mockConsole, startDraft } from "./rule-fixture";

test("editor tabs and preview actions fit the viewport", async ({ page }, info) => {
  const definition = blankRuleDefinition("Synthetic layout fixture");
  definition.sections = [{ id: "section", title: "Measurements", description: "", questions: [
    questionSchema.parse({ id: "weight", label: "Weight", type: "number", unit: "kg", purpose: "assessment", required: true }),
  ] }];
  await mockConsole(page, definition);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await page.screenshot({ path: info.outputPath("preview.png"), fullPage: true });
  const dialog = page.getByRole("dialog", { name: "Synthetic browser draft", exact: true });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  for (const label of ["Run preview", "Clear answers", "Use answers as a sample"]) {
    const action = page.getByRole("button", { name: label, exact: true });
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  }
  expect(await dialog.evaluate(el => [el, ...el.querySelectorAll("div, section, fieldset")].filter(node => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1).map(node => node.tagName))).toEqual([]);
});

test("spreadsheet editor sections fit narrow and desktop layouts", async ({ page }, info) => {
  const { createSpreadsheetTemplate } = await import("@niq-scoring/contracts/rule-template");
  await mockConsole(page, createSpreadsheetTemplate("Layout template"));
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic browser draft", exact: true });
  for (const tab of ["Details", "Questionnaire", "Scoring", "Interventions", "Validation", "Preview"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
    if (tab === "Questionnaire") {
      await page.locator("#rule-question-tumour_type > summary").click();
    }
    await page.screenshot({ path: info.outputPath(`${tab.toLowerCase()}.png`), animations: "disabled" });
    const overflowing = await dialog.evaluate(el => [el, ...el.querySelectorAll("div, section, fieldset")]
      .filter(node => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1)
      .map(node => ({ tag: node.tagName, text: node.textContent?.slice(0, 80) })));
    expect.soft(overflowing, `${tab} horizontal overflow`).toEqual([]);
  }
});
