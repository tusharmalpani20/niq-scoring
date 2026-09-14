import { expect, test } from "@playwright/test";
import type { EditableRule } from "../src/rules/rule-api";
import { exerciseScoringWorkflow } from "./scoring-workflow";

test("real API login, spreadsheet draft, reopen, duplicate and protected deletion", async ({ page }, info) => {
  const name = `Synthetic browser ${info.project.name} ${Date.now()}`;
  // No page.route interception: requests use the production Hono routes,
  // authentication and validators with disposable in-memory persistence.
  await page.goto("/versions");
  await page.getByLabel("Email address", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-browser-test-only-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/versions");
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await page.getByLabel("Version name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText("Source decisions", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await page.getByLabel("Description", { exact: true }).fill("Synthetic browser persistence check");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Validation", exact: true }).click();
  await page.getByRole("button", { name: "Validate version", exact: true }).click();
  await expect(page.getByRole("list", { name: "Validation issues" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve version", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Synthetic browser persistence check");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: `Duplicate ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Synthetic browser persistence check");
  await page.getByLabel("Description", { exact: true }).fill("Copy-only change");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Synthetic browser persistence check");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const title of [`${name} copy`, name]) {
    await page.getByRole("button", { name: `Delete ${title}`, exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Audit history is retained.");
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  }
});

test("author a complete synthetic version through real API validation and lifecycle", async ({ page }, info) => {
  const name = `Synthetic lifecycle ${info.project.name} ${Date.now()}`;
  await page.goto("/versions");
  await page.getByLabel("Email address", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-browser-test-only-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/versions");
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await page.getByLabel("Version name", { exact: true }).fill(name);
  await page.getByLabel("Starting point", { exact: true }).selectOption("blank");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const creation = page.waitForResponse(response => response.url().endsWith("/api/admin/rules") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  const response = await creation;
  expect(response.status()).toBe(201);
  const created = await response.json() as EditableRule;
  const getRecord = async () => {
    const response = await page.request.get(`/api/admin/rules/${created.id}`);
    expect(response.status()).toBe(200);
    return await response.json() as EditableRule;
  };
  await page.getByRole("tab", { name: "Questionnaire", exact: true }).click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Section title", { exact: true }).fill("Synthetic questions");
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page.locator("summary").filter({ hasText: "New question" }).click();
  await page.getByLabel("Question label", { exact: true }).fill("Synthetic choice");
  await page.getByRole("combobox", { name: "Field type", exact: true }).selectOption("single_select");
  await page.getByRole("checkbox", { name: "Required answer", exact: true }).check();
  await page.getByLabel("Option label", { exact: true }).fill("Choice A");
  await page.getByRole("button", { name: "Add option", exact: true }).click();
  await page.getByLabel("Option label", { exact: true }).nth(1).fill("Choice B");
  await exerciseScoringWorkflow(page, getRecord);
  const retired = await getRecord();
  expect(retired.lifecycle).toBe("RETIRED");
  expect(retired.audit?.map(event => event.action)).toEqual(expect.arrayContaining([
    "RULE_CREATED", "RULE_SAVED", "RULE_VALIDATED", "RULE_APPROVED", "RULE_ACTIVE", "RULE_RETIRED",
  ]));
});
