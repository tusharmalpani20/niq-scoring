import { expect, test } from "@playwright/test";
import { blankRuleDefinition, questionSchema } from "@niq-scoring/contracts/rules";
import { mockConsole, startDraft } from "./rule-fixture";

test("creation retry preserves setup and request identity", async ({ page }) => {
  const state = await mockConsole(page);
  state.createError = "RULE_NAME_EXISTS";
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByText("A rule version with this name already exists.")).toBeVisible();
  await expect(page.getByText("Synthetic browser draft", { exact: true })).toBeVisible();
  state.createError = "";
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Synthetic browser draft", exact: true })).toBeVisible();
  expect(state.createRequests).toHaveLength(2);
  expect(state.createRequests[0]!.requestId).toBe(state.createRequests[1]!.requestId);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
});

test("save conflict retains edits and discard requires a deliberate choice", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Unsaved synthetic description");
  state.saveError = "RULE_REVISION_CONFLICT";
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/This version changed in another session/)).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved synthetic description");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved synthetic description");
  state.saveError = "";
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Synthetic browser draft", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved synthetic description");
});

test("question and option editing preserves identifiers through reorder, save and preview", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Questionnaire", exact: true }).click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Section title", { exact: true }).fill("Synthetic section");
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page.locator("summary").filter({ hasText: "New question" }).click();
  await page.getByLabel("Question label", { exact: true }).fill("Synthetic choice");
  await page.getByRole("combobox", { name: "Field type", exact: true }).selectOption("single_select");
  await page.getByLabel("Option label", { exact: true }).fill("First option");
  await page.getByRole("button", { name: "Add option", exact: true }).click();
  await page.getByLabel("Option label", { exact: true }).nth(1).fill("Second option");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const original = structuredClone(state.getRecord()!.definition.sections[0]!.questions[0]!);
  await page.getByRole("button", { name: "Move Second option up", exact: true }).click();
  await page.getByLabel("Question label", { exact: true }).fill("Renamed choice");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const saved = state.getRecord()!.definition.sections[0]!.questions[0]!;
  expect(saved.id).toBe(original.id);
  expect(saved.options.map(option => option.id)).toEqual([...original.options].reverse().map(option => option.id));
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const answer = page.getByLabel("Renamed choice", { exact: true });
  await expect(answer.locator("option")).toHaveText(["Select an answer", "Second option", "First option"]);
  await answer.selectOption(saved.options[0]!.id);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(answer).toHaveValue(saved.options[0]!.id);
});

test("conditional questions preview yes and no, and clearing a comparison does not select no", async ({ page }) => {
  const definition = blankRuleDefinition("Synthetic conditional fixture");
  definition.sections = [{ id: "questions", title: "Synthetic questions", description: "", questions: [
    questionSchema.parse({ id: "show", label: "Show follow-up", type: "boolean", purpose: "assessment", required: false }),
    questionSchema.parse({ id: "follow_up", label: "Follow-up note", type: "text", purpose: "assessment", required: false }),
  ] }];
  const state = await mockConsole(page, definition);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Questionnaire", exact: true }).click();
  const followUp = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Follow-up note" }) });
  await followUp.locator("summary").click();
  await followUp.getByRole("button", { name: "Add condition", exact: true }).click();
  await followUp.getByRole("combobox", { name: "Field", exact: true }).selectOption("question:show");
  await followUp.getByRole("combobox", { name: "Comparison", exact: true }).selectOption("eq");
  const comparison = followUp.getByRole("combobox", { name: "Value", exact: true });
  await comparison.selectOption("true");
  await comparison.selectOption("");
  await expect(comparison).toHaveValue("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("list", { name: "Validation issues" })).toContainText("Choose a comparison value.");
  expect(state.getRecord()!.revision).toBe(1);
  await comparison.selectOption("true");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.getByLabel("Follow-up note", { exact: true })).toBeHidden();
  await page.getByRole("combobox", { name: "Show follow-up", exact: true }).selectOption("true");
  await expect(page.getByLabel("Follow-up note", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Show follow-up", exact: true }).selectOption("false");
  await expect(page.getByLabel("Follow-up note", { exact: true })).toBeHidden();

  await page.getByRole("tab", { name: "Questionnaire", exact: true }).click();
  const controller = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Show follow-up" }) });
  await controller.locator("summary").click();
  await controller.getByRole("button", { name: "Remove question", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Dependent rules must be updated");
  await page.getByRole("button", { name: "Keep field", exact: true }).click();
  await expect(controller).toBeVisible();
  await controller.getByRole("button", { name: "Remove question", exact: true }).click();
  await page.getByRole("button", { name: "Continue with change", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("list", { name: "Validation issues" })).toContainText("Unknown question: show.");
  expect(state.getRecord()!.definition.sections[0]!.questions).toHaveLength(2);
});
