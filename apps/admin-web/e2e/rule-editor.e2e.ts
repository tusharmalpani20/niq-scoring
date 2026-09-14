import { expect, test, type Page } from "@playwright/test";
import { createSpreadsheetTemplate } from "@niq-scoring/contracts/rule-template";
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

test("Excel questionnaire exposes fixed fields and options without authoring controls", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Questionnaire", exact: true }).click();
  for (const name of ["Add section", "Add question", "Add option", "Add calculation", "Remove question"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await page.locator("#rule-question-tumour_type > summary").click();
  await expect(page.locator("#rule-question-tumour_type")).toContainText("Solid tumour");
  await expect(page.locator("#rule-question-tumour_type")).toContainText("Haematological");
  await expect(page.getByLabel("Question label", { exact: true })).toHaveCount(0);
  expect(state.getRecord()!.definition.sections).toEqual(createSpreadsheetTemplate("Reference").sections);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
});

test("fixed questionnaire preview respects conditional fields", async ({ page }) => {
  await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const relation = page.getByLabel("Relation", { exact: true });
  await expect(relation).toBeHidden();
  await page.getByRole("combobox", { name: "Family history of cancer?", exact: true }).selectOption("true");
  await expect(relation).toBeVisible();
  await page.getByRole("combobox", { name: "Family history of cancer?", exact: true }).selectOption("false");
  await expect(relation).toBeHidden();
});

test("creation protects name changes and back navigation", async ({ page }) => {
  await mockConsole(page);
  await navigateToVersions(page);
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await expect(page.getByLabel("Starting point", { exact: true })).toHaveCount(0);
  await page.getByLabel("Version name", { exact: true }).fill("Unsaved setup");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Discard this draft setup?");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Version name", { exact: true })).toHaveValue("Unsaved setup");
  await page.getByLabel("Version name", { exact: true }).fill("Unsaved setup");
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(/\/versions$/);
  await expect(page.getByLabel("Version name", { exact: true })).toHaveValue("Unsaved setup");
  await page.evaluate(() => window.history.back());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});


async function navigateToVersions(page: Page) {
  await page.goto("/overview");
  if (!await page.getByRole("link", { name: "Rule versions", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  }
  await page.getByRole("link", { name: "Rule versions", exact: true }).click();
  const sidebar = page.getByRole("dialog", { name: "Sidebar", exact: true });
  if (await sidebar.isVisible()) await page.keyboard.press("Escape");
}

test("editing keeps unsaved changes on back navigation until discard", async ({ page }) => {
  await mockConsole(page);
  await navigateToVersions(page);
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await page.getByLabel("Version name", { exact: true }).fill("Navigation fixture");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Unsaved edit");
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("alertdialog")).toContainText("Discard unsaved changes?");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved edit");
  await page.evaluate(() => window.history.back());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
