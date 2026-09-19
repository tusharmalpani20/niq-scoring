import { expect, test } from "@playwright/test";
import { mockFinalConsole, startFinalDraft } from "./final-assessment-fixture";

test("final assessment editor follows the audited section layout", async ({ page }, info) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await expect(page.getByText(/Temporary risk thresholds/)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Scoring sections" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Cap", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /options configured/ }).first().click();
  await expect(page.getByLabel("Solid Tumour points", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Source:/)).toHaveCount(0);
  await page.getByLabel("Solid Tumour points", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.getRecord()!.definition.sections[0]!.fields[0]!.kind).toBe("multi_select");
  const tumour = state.getRecord()!.definition.sections[0]!.fields[0]!;
  expect(tumour.kind === "multi_select" && tumour.scoring.points.find(point => point.optionId === "tumour_type_solid")?.points).toBe(4);
  await page.screenshot({ path: info.outputPath("final-assessment-desktop.png"), animations: "disabled", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

for (const width of [390, 768, 845, 1065, 1440]) {
  test(`final assessment has no clipping at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 797 });
    await mockFinalConsole(page);
    await startFinalDraft(page);
    const navigation = page.getByRole("navigation", { name: "Scoring sections" });
    await expect(navigation).toBeVisible();
    const navBox = await navigation.boundingBox();
    const firstSection = await navigation.getByRole("button").first().boundingBox();
    expect(Math.abs(firstSection!.x - navBox!.x)).toBeLessThanOrEqual(1);
    await expect(page.getByLabel("Assessment section", { exact: true })).toHaveCount(0);
    await navigation.getByRole("button", { name: /Dietary details/ }).click();
    await page.locator("#final-field-weight_loss").getByRole("button").click();
    await expect(page.getByText("Mild weight loss", { exact: true }).filter({ visible: true })).toBeVisible();
    await page.locator("#final-field-protein_intake").getByRole("button").click();
    await expect(page.getByText("Normal intake · More than usual")).toBeVisible();
    await expect(page.getByText(/dietary_intake_/)).toHaveCount(0);
    // Multiple panels stay open for comparing related scores, as in the design.
    await expect(page.locator("#final-scoring-weight_loss")).toBeVisible();
    const weightPoints = page.locator("#final-scoring-weight_loss input[type=number]");
    for (const input of await weightPoints.all()) {
      if (await input.isVisible()) expect((await input.boundingBox())!.width).toBeLessThanOrEqual(90);
    }
    for (const tab of ["Risk categories", "Face scan", "Scoring"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      expect(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("main *")).filter(el => el.clientWidth > 1 && !el.classList.contains("sr-only") && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== "visible").map(el => el.tagName + "." + el.className))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastField = await page.locator("#final-field-fluid_intake").boundingBox();
    const saveBar = await page.getByRole("button", { name: "Save draft", exact: true }).locator("../..").boundingBox();
    expect(lastField!.y + lastField!.height).toBeLessThanOrEqual(saveBar!.y + 1);
    const footer = page.getByRole("button", { name: "Save draft", exact: true });
    const box = await footer.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(797);
    await page.screenshot({ path: info.outputPath(`confirmed-scoring-${width}.png`), animations: "disabled", fullPage: true });
  });
}

test("blank and fractional points remain unsaved and cannot be submitted", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.locator("#final-field-tumour_type").getByRole("button").click();
  const points = page.getByLabel("Solid Tumour points", { exact: true });
  await points.fill("");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Enter valid ranges and whole-number points of 0 or more.")).toBeVisible();
  await points.fill("1.5");
  await expect(points).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const field = state.getRecord()!.definition.sections[0]!.fields[0]!;
  expect(field.kind === "multi_select" && field.scoring.points[0]!.points).toBe(2);
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(points).toHaveValue("2");
});

test("final assessment save conflicts preserve edits", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Unsaved final profile change");
  state.saveError = "RULE_REVISION_CONFLICT";
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/This version changed in another session/)).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Unsaved final profile change");
});

test("risk names reject duplicates and blank numeric ranges stay invalid", async ({ page }) => {
  await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Risk categories", exact: true }).click();
  await page.getByLabel("Category name", { exact: true }).nth(1).fill("Low Risk");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByLabel("Configuration issues")).toContainText(/unique|duplicate/i);
  await page.getByLabel("Category name", { exact: true }).nth(1).fill("Moderate Risk");
  const from = page.getByLabel("From score", { exact: true }).nth(1);
  await from.fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByLabel("Configuration issues")).toContainText("Enter valid ranges");
  await expect(from).toHaveValue("");
  await expect(from).toHaveAttribute("aria-invalid", "true");
});

test("confirmed drafts validate, approve explicitly and activate without editing approved settings", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Pending change");
  await expect(page.getByRole("button", { name: "Validate draft", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("button", { name: "Validate draft", exact: true }).click();
  await page.getByRole("button", { name: "Approve version", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("duplicate this version");
  expect(state.getRecord()!.lifecycle).toBe("VALIDATED");
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve version", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Activate version", exact: true }).click();
  await expect(page.getByText("Version activated.", { exact: true })).toBeVisible();
  expect(state.getRecord()!.lifecycle).toBe("ACTIVE");
});
