import { expect, test } from "@playwright/test";

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
