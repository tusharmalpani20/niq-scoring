import { expect, test, type Page } from "@playwright/test";
import { createSpreadsheetTemplate } from "@niq-scoring/contracts/rule-template";
import { mockConsole, startDraft } from "./rule-fixture";

test("creation retry preserves setup and request identity", async ({ page }) => {
  const state = await mockConsole(page);
  state.createError = "RULE_NAME_EXISTS";
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByText("A rule version with this name already exists.")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Synthetic browser draft");
  state.createError = "";
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/Synthetic%20browser%20draft$/);
  await expect(page.getByRole("heading", { name: "Synthetic browser draft", exact: true })).toBeVisible();
  expect(state.createRequests).toHaveLength(2);
  expect(state.createRequests[0]!.requestId).toBe(state.createRequests[1]!.requestId);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
});

test("save conflict retains edits and discard requires a deliberate choice", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Unsaved synthetic description");
  state.saveError = "RULE_REVISION_CONFLICT";
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/This version changed in another session/)).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved synthetic description");
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved synthetic description");
  state.saveError = "";
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/^Draft saved\./)).toBeVisible();
  await page.getByRole("button", { name: "Back to versions", exact: true }).click();
  await page.getByRole("button", { name: "Synthetic browser draft", exact: true }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved synthetic description");
});

test("one scoring page replaces questionnaire, preview and validation authoring", async ({ page }) => {
  const state = await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/Synthetic%20browser%20draft$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const name of ["Questionnaire", "Preview", "Validation"]) {
    await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(0);
  }
  for (const name of ["Add section", "Add question", "Add option", "Add calculation", "Remove question", "Approve version"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("columnheader", { name: "Field name", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Type", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Score", exact: true })).toBeVisible();
  await expect(page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Field name", exact: true }) }).getByRole("columnheader", { name: "Cap", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Interventions", exact: true }).click();
  await expect(page.getByText(/N\/A.*not finalized/i)).toBeVisible();
  expect(state.getRecord()!.definition.sections).toEqual(createSpreadsheetTemplate("Reference").sections);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
});

test("version link and edit action open a refreshable page", async ({ page }) => {
  await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.goto("/versions");
  await page.getByRole("button", { name: "Synthetic browser draft", exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/Synthetic%20browser%20draft$/);
  await page.reload();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Synthetic browser draft");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/versions");
  await page.getByRole("button", { name: "Edit Synthetic browser draft", exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/Synthetic%20browser%20draft$/);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Synthetic browser draft");
});

test("creation protects name changes and back navigation", async ({ page }) => {
  await mockConsole(page);
  await navigateToVersions(page);
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await expect(page.getByLabel("Starting point", { exact: true })).toHaveCount(0);
  await page.getByLabel("Name", { exact: true }).fill("Unsaved setup");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Discard this draft setup?");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Unsaved setup");
  await page.getByLabel("Name", { exact: true }).fill("Unsaved setup");
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(/\/versions$/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Unsaved setup");
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
  await page.getByLabel("Name", { exact: true }).fill("Navigation fixture");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Unsaved edit");
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("alertdialog")).toContainText("Discard unsaved changes?");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved edit");
  await page.evaluate(() => window.history.back());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/versions$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
