import { expect, type Page } from "@playwright/test";
import type { EditableRule } from "../src/rules/rule-api";

export async function exerciseScoringWorkflow(page: Page, getRecord: () => Promise<EditableRule>) {
  await page.getByRole("tab", { name: "Scoring", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add option scoring", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await page.getByLabel("Domain name", { exact: true }).fill("Synthetic domain");
  await page.getByLabel("Domain cap", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Add option scoring", exact: true }).click();
  await page.getByLabel("Rule name", { exact: true }).fill("Synthetic points");
  await page.getByLabel("Choice A", { exact: true }).fill("0");
  await page.getByLabel("Choice B", { exact: true }).fill("10");
  await expect(page.getByRole("button", { name: "Remove domain", exact: true })).toBeDisabled();
  await page.getByLabel("Total cap", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Add classification", exact: true }).click();
  await page.getByLabel("Classification name", { exact: true }).fill("Synthetic category");
  await page.getByLabel("Interpretation", { exact: true }).fill("Test output only");
  await page.getByRole("tab", { name: "Interventions", exact: true }).click();
  await page.getByRole("button", { name: "Add intervention", exact: true }).click();
  await page.getByLabel("Intervention name", { exact: true }).fill("Synthetic note");
  await page.getByRole("combobox", { name: "Guidance type", exact: true }).click();
  await page.getByRole("option", { name: "Note", exact: true }).click();
  await page.getByLabel("Guidance", { exact: true }).fill("Synthetic text, no clinical meaning.");
  await page.getByRole("combobox", { name: "Comparison", exact: true }).selectOption("gte");
  await page.getByLabel("Value", { exact: true }).fill("7");
  await page.getByLabel("Priority (0–10000)", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const saved = (await getRecord()).definition;
  expect(saved.scoring[0]).toMatchObject({ kind: "options", questionId: saved.sections[0]!.questions[0]!.id, points: [
    { optionId: saved.sections[0]!.questions[0]!.options[0]!.id, points: 0 }, { optionId: saved.sections[0]!.questions[0]!.options[1]!.id, points: 10 },
  ] });
  expect(saved.domains[0]!.cap).toBe(8);
  expect(saved.total.cap).toBe(7);
  expect(saved.interventions[0]).toMatchObject({ kind: "note", priority: 2,
    when: { match: "all", tests: [{ ref: { kind: "total", id: "total" }, operator: "gte", value: 7 }] } });

  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await page.getByRole("combobox", { name: "Synthetic choice *", exact: true }).selectOption(saved.sections[0]!.questions[0]!.options[1]!.id);
  await page.getByRole("button", { name: "Run preview", exact: true }).click();
  await expect(page.getByRole("region", { name: "Preview result", exact: true })).toContainText("Score: 7 · Synthetic category");
  await expect(page.getByRole("region", { name: "Triggered guidance", exact: true })).toContainText("Synthetic text, no clinical meaning.");
  await page.getByRole("tab", { name: "Validation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve version", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add sample case", exact: true }).click();
  await expect(page.getByLabel("Expected total score", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Expect a complete assessment", { exact: true })).not.toBeChecked();
  await page.getByLabel("Sample name", { exact: true }).fill("Synthetic capped result");
  await page.locator("summary").filter({ hasText: "Sample answers" }).click();
  await page.getByRole("combobox", { name: "Synthetic choice *", exact: true }).selectOption(saved.sections[0]!.questions[0]!.options[1]!.id);
  await page.getByLabel("Expect a complete assessment", { exact: true }).check();
  await page.getByLabel("Expected total score", { exact: true }).fill("7");
  await page.getByRole("combobox", { name: "Expected classification", exact: true }).selectOption(saved.classifications[0]!.id);
  await page.getByRole("checkbox", { name: "Synthetic note", exact: true }).check();
  await page.getByLabel("Synthetic domain", { exact: true }).fill("8");
  await expect(page.getByRole("button", { name: "Validate version", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect((await getRecord()).definition.samples[0]).toMatchObject({ answers: { [saved.sections[0]!.questions[0]!.id]: saved.sections[0]!.questions[0]!.options[1]!.id }, expected: {
    complete: true, score: 7, classificationId: saved.classifications[0]!.id,
    interventionIds: [saved.interventions[0]!.id], domains: { [saved.domains[0]!.id]: 8 }, calculations: {},
  } });
  await expect(page.getByRole("button", { name: "Validate version", exact: true })).toBeEnabled();
  // A deliberately incorrect expectation must be visible as a navigable issue.
  await page.getByLabel("Expected total score", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Validate version", exact: true }).click();
  await expect(page.getByRole("list", { name: "Validation issues" })).toContainText("score expected 6, received 7");
  await expect(page.getByRole("button", { name: "Approve version", exact: true })).toHaveCount(0);
  await page.getByRole("list", { name: "Validation issues" }).getByRole("button").click();
  await expect(page.locator("summary").filter({ hasText: "Synthetic capped result" })).toBeFocused();
  await expect(page.getByLabel("Expected total score", { exact: true })).toBeVisible();
  await page.getByLabel("Expected total score", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Validate version", exact: true }).click();
  await expect(page.getByText("Version validated.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve version", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Confirm that its clinical content has been reviewed.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await getRecord()).lifecycle).toBe("VALIDATED");
  await page.getByRole("button", { name: "Approve version", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Version approved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add sample case", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Version name", { exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Validation", exact: true }).click();
  await page.getByRole("button", { name: "Activate version", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Version activated.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retire version", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Historical evidence is retained.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Version retired.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate version", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retire version", exact: true })).toHaveCount(0);
}
