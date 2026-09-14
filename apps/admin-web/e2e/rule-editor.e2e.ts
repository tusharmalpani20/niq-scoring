import { expect, test, type Page } from "@playwright/test";
import { blankRuleDefinition } from "@niq-scoring/contracts/rules";
import type { EditableRule } from "../src/rules/rule-api";

// Every API request is intercepted. These interaction tests never use a real
// session, database, clinical rule or deployment, including when they fail.
async function mockConsole(page: Page) {
  let record: EditableRule | null = null;
  const state = { createError: "", saveError: "", createRequests: [] as Array<{ requestId: string; name: string }>, getRecord: () => record };
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/auth/status") return json({ setupRequired: false });
    if (path === "/api/auth/session") return json({ user: { id: "synthetic-admin", displayName: "Browser QA", enabled: true } });
    if (path === "/api/admin/overview") return json({ clients: [], deployments: [], assignments: [], entitlements: [], versions: [] });
    if (path === "/api/admin/rules" && request.method() === "GET") return json({ versions: record ? [record] : [] });
    if (path === "/api/admin/rules" && request.method() === "POST") {
      const body = request.postDataJSON();
      state.createRequests.push(body);
      if (state.createError) return json({ error: state.createError }, 409);
      record = { id: "synthetic-rule", version: body.name, lifecycle: "DRAFT", clinicalUsePermitted: false,
        revision: 1, packageChecksum: "synthetic", editable: true, definition: blankRuleDefinition(body.name) };
      return json(record);
    }
    if (path === "/api/admin/rules/synthetic-rule" && record) {
      if (request.method() === "GET") return json(record);
      if (request.method() === "PUT") {
        if (state.saveError) return json({ error: state.saveError }, 409);
        const body = request.postDataJSON();
        expect(body.revision).toBe(record.revision);
        record = { ...record, version: body.definition.name, definition: body.definition, revision: record.revision + 1 };
        return json(record);
      }
    }
    return json({ error: "UNEXPECTED_TEST_REQUEST" }, 500);
  });
  return state;
}

async function startDraft(page: Page) {
  await page.goto("/versions");
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await page.getByLabel("Version name", { exact: true }).fill("Synthetic browser draft");
  await page.getByLabel("Starting point", { exact: true }).selectOption("blank");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

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
