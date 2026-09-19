import { expect, test } from "@playwright/test";
import { mockConsole, startDraft } from "./rule-fixture";

test("scoring page and expanded options fit narrow and desktop layouts", async ({ page }, info) => {
  await mockConsole(page);
  await startDraft(page);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/Synthetic%20browser%20draft$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Version details", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("version-details.png"), animations: "disabled", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("tab", { name: "Scoring", exact: true }).click();
  await page.locator("#rule-field-tumour_type").getByRole("button", { name: /configured/ }).click();
  await expect(page.getByLabel("Solid tumour", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("scoring-page.png"), animations: "disabled", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const save = page.getByRole("button", { name: "Save draft", exact: true });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
