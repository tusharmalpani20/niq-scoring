import { exerciseScoringWorkflow } from "./scoring-workflow";
import { expect, test } from "@playwright/test";
import { blankRuleDefinition, questionSchema } from "@niq-scoring/contracts/rules";
import { mockConsole, startDraft } from "./rule-fixture";

test("author option points, caps, guidance and independent sample expectations", async ({ page }) => {
  const definition = blankRuleDefinition("Synthetic scoring fixture");
  definition.sections = [{ id: "section", title: "Synthetic", description: "", questions: [
    questionSchema.parse({ id: "choice", label: "Synthetic choice", type: "single_select", purpose: "scoring", required: true,
      options: [{ id: "option_a", label: "Choice A" }, { id: "option_b", label: "Choice B" }] }),
  ] }];
  const state = await mockConsole(page, definition);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await exerciseScoringWorkflow(page, async () => state.getRecord()!);
});

test("calculation operands and numeric ranges produce explicit boundary results in preview", async ({ page }) => {
  const definition = blankRuleDefinition("Synthetic numeric fixture");
  definition.sections = [{ id: "section", title: "Synthetic numbers", description: "", questions: [
    questionSchema.parse({ id: "amount", label: "Synthetic amount", type: "number", purpose: "scoring", required: true }),
  ] }];
  const state = await mockConsole(page, definition);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Questionnaire", exact: true }).click();
  await page.getByRole("button", { name: "Add calculation", exact: true }).click();
  await page.getByLabel("Calculation label", { exact: true }).fill("Doubled amount");
  await page.getByRole("combobox", { name: "Operation", exact: true }).selectOption("multiply");
  await page.getByRole("combobox", { name: "Operand 1", exact: true }).selectOption("question:amount");
  await page.getByRole("button", { name: "Add operand", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Number", exact: true }).fill("2");
  await page.getByRole("tab", { name: "Scoring", exact: true }).click();
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await page.getByRole("button", { name: "Add range scoring", exact: true }).click();
  await page.getByRole("combobox", { name: "Numeric input", exact: true }).click();
  await page.getByRole("option", { name: "Doubled amount", exact: true }).click();
  await page.getByLabel("Maximum (blank = unbounded)", { exact: true }).fill("10");
  await page.getByRole("checkbox", { name: "Include maximum", exact: true }).uncheck();
  await page.getByLabel("Range points", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Add range", exact: true }).click();
  await page.getByLabel("Minimum (blank = unbounded)", { exact: true }).nth(1).fill("10");
  await page.getByLabel("Range points", { exact: true }).nth(1).fill("5");
  await page.getByRole("button", { name: "Add classification", exact: true }).click();
  await page.getByLabel("Classification name", { exact: true }).fill("Synthetic result");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.getRecord()!.definition.calculations[0]!.operands).toEqual([
    { kind: "question", id: "amount" }, { kind: "constant", value: 2 },
  ]);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Run preview", exact: true }).click();
  await expect(page.getByRole("region", { name: "Preview result", exact: true })).toContainText("Incomplete assessment");
  for (const [input, score] of [["0", 2], ["4.99", 2], ["5", 5]] as const) {
    await page.getByLabel("Synthetic amount *", { exact: true }).fill(input);
    await page.getByRole("button", { name: "Run preview", exact: true }).click();
    await expect(page.getByRole("region", { name: "Preview result", exact: true })).toContainText(`Score: ${score} · Synthetic result`);
  }
});
