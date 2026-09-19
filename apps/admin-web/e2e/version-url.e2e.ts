import { expect, test } from '@playwright/test';
import { mockFinalConsole, startFinalDraft } from './final-assessment-fixture';
import { versionUrl } from '../src/rules/version-url';

test('name links reload, rename and preserve old bookmarks', async ({ page }) => {
  await mockFinalConsole(page);
  await startFinalDraft(page);
  const oldUrl = page.url();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole('heading', { name: 'Final assessment browser draft', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('TEST-1 / follow-up #2');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(versionUrl('TEST-1 / follow-up #2').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  await page.goto(oldUrl);
  await expect(page.getByRole('heading', { name: 'TEST-1 / follow-up #2', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(oldUrl);
});

test('an existing ID bookmark redirects to the current name', async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  const legacyId = '01M2T6J93S5GTN6PCJNFAQ0WJ2';
  await page.route(`**/api/admin/rules/${legacyId}`, route => route.fulfill({ json: state.getRecord() }));
  await page.goto(`/versions/${legacyId}`);
  await expect(page).toHaveURL(/\/versions\/Final%20assessment%20browser%20draft$/);
  await expect(page.getByRole('heading', { name: 'Final assessment browser draft', exact: true })).toBeVisible();
});
