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
  await expect(page.getByRole("alert", { name: "Range errors" })).toContainText(/unique|duplicate/i);
  await page.getByLabel("Category name", { exact: true }).nth(1).fill("Moderate Risk");
  const from = page.getByLabel("From score", { exact: true }).nth(1);
  await from.fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Enter a whole number of 0 or more.", { exact: true })).toBeVisible();
  await expect(from).toHaveValue("");
  await expect(from).toHaveAttribute("aria-invalid", "true");
});

test("confirmed drafts validate, approve explicitly and activate without editing approved settings", async ({ page }, info) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Pending change");
  await expect(page.getByRole("button", { name: "Check rules", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("button", { name: "Check rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Checks passed");
  await page.getByRole("button", { name: "Continue to approval", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("duplicate this version");
  expect(state.getRecord()!.lifecycle).toBe("VALIDATED");
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve version", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Version approved");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Activate version", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("You can assign Final assessment browser draft in Deployments after activation.");
  await expect(page.getByRole("checkbox", { name: /Make this the default version/ })).not.toBeChecked();
  expect(state.getRecord()!.lifecycle).toBe("APPROVED");
  await page.getByRole("alertdialog").getByRole("button", { name: "Activate version", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Version activated");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const timeline = page.getByRole("region", { name: "Version timeline" });
  await expect(timeline).toContainText("Current: Active");
  await expect(timeline.locator('[aria-current="step"]')).not.toContainText("Browser QA");
  await timeline.getByRole("button", { name: "Active details", exact: true }).click();
  await expect(page.getByRole("tooltip")).toContainText("Browser QA");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(timeline.locator('[aria-current="step"] time')).toHaveAttribute("datetime", /2026-09-19/);
  await page.reload();
  await expect(timeline).toContainText("Current: Active");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await timeline.screenshot({ path: info.outputPath("version-timeline.png") });
  expect(state.getRecord()!.lifecycle).toBe("ACTIVE");
  expect(state.getRecord()!.isDefault).not.toBe(true);
  await page.getByRole("button", { name: "Make default", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Assessments already started keep their original rules.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.getRecord()!.isDefault).not.toBe(true);
  await page.getByRole("button", { name: "Make default", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Make default", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Default updated");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(state.getRecord()!.isDefault).toBe(true);
  await page.reload();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make default", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retire version", exact: true })).toBeDisabled();
  await expect(page.getByText("To retire this default, open another active version and choose Make default first.")).toBeVisible();
});

test("activation can explicitly make a version the default", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await page.route("**/api/admin/overview", route => route.fulfill({ json: {
    clients: [], entitlements: [],
    deployments: ["following", "paused", "pinned-old", "pinned-new"].map(id => ({ id, enabled: id !== "paused" })),
    versions: [{ id: "old", version: "Previous rules", isDefault: true }],
    assignments: [
      { deploymentId: "following", mode: "LATEST_APPROVED" },
      { deploymentId: "paused", mode: "LATEST_APPROVED" },
      { deploymentId: "pinned-old", mode: "PINNED", scoringRuleVersionId: "old" },
      { deploymentId: "pinned-new", mode: "PINNED", scoringRuleVersionId: "final-assessment-rule" },
    ],
  } }));
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByRole("button", { name: "Check rules", exact: true }).click();
  await page.getByRole("button", { name: "Continue to approval", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve version", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Activate version", exact: true }).click();
  await page.getByRole("checkbox", { name: /Make this the default version/ }).check();
  const impact = page.getByRole("region", { name: "Default change impact" });
  await expect(impact).toContainText("Previous rules");
  await expect(impact).toContainText("Final assessment browser draft");
  await expect(impact).toContainText("2 deployments will use Final assessment browser draft for new assessments.");
  await expect(impact.getByText("3 deployments currently use Previous rules.")).not.toBeVisible();
  await impact.getByText("View deployment details", { exact: true }).click();
  await expect(impact.getByText("3 deployments currently use Previous rules.")).toBeVisible();
  await expect(impact).toContainText("1 deployment is set to Previous rules directly and will keep using it.");
  await expect(impact).toContainText("1 deployment already uses Final assessment browser draft directly.");
  await expect(impact).toContainText("1 paused deployment is included in the switch.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Activate version", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Deployments following the default");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(state.getRecord()!.isDefault).toBe(true);
  await page.getByText("Activity history", { exact: true }).click();
  await expect(page.getByText("Made default", { exact: true })).toBeVisible();
  await page.goto("/versions");
  await expect(page.getByRole("row").filter({ hasText: "Final assessment browser draft" })).toContainText("Default");
});

test("face scan ranges persist and gaps cannot be saved", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Face scan", exact: true }).click();
  await expect(page.getByText(/cutoff/i)).toHaveCount(0);
  await page.getByLabel("To (%)", { exact: true }).nth(0).fill("65.5");
  await page.getByLabel("From (%)", { exact: true }).nth(1).fill("65.5");
  await page.getByLabel("Points", { exact: true }).nth(0).fill("4");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Face scan", exact: true }).click();
  await expect(page.getByLabel("To (%)", { exact: true }).nth(0)).toHaveValue("65.5");
  await expect(page.getByLabel("Points", { exact: true }).nth(0)).toHaveValue("4");
  await page.getByRole("button", { name: "Add range", exact: true }).click();
  await expect(page.getByLabel("Points", { exact: true })).toHaveCount(4);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const saved = structuredClone(state.getRecord()!.definition.faceScanScoring);
  await page.getByLabel("From (%)", { exact: true }).nth(1).fill("66");
  await expect(page.getByRole("alert", { name: "Range errors" })).toContainText("gap");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByLabel("Configuration issues")).toHaveCount(0);
  await expect(page.getByRole("alert", { name: "Range errors" })).toBeVisible();
  expect(state.getRecord()!.definition.faceScanScoring).toEqual(saved);
  await page.getByLabel("From (%)", { exact: true }).nth(1).fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByLabel("From (%)", { exact: true }).nth(1)).toHaveAttribute("aria-invalid", "true");
});

test("simple risk ranges preserve exclusive historical endpoints and save inclusive edits", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Risk categories", exact: true }).click();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByLabel("From score", { exact: true }).nth(2)).toHaveValue("26");
  await page.getByLabel("To score", { exact: true }).nth(0).fill("14");
  await page.getByLabel("From score", { exact: true }).nth(1).fill("15");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.getRecord()!.definition.riskCategories[0]).toMatchObject({ max: 14, maxInclusive: true });
  expect(state.getRecord()!.definition.riskCategories[1]).toMatchObject({ min: 15, minInclusive: true });
  await page.getByLabel("No upper limit", { exact: true }).last().uncheck();
  await page.getByLabel("To score", { exact: true }).last().fill("");
  await page.getByLabel("No upper limit", { exact: true }).last().check();
  const save = page.getByRole("button", { name: "Save draft", exact: true });
  if (await save.isEnabled()) await save.click();
  await expect(page.getByLabel("Configuration issues")).toHaveCount(0);
});


test("risk overlap is visible before saving and cannot persist", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Risk categories", exact: true }).click();
  await page.getByLabel("From score", { exact: true }).nth(2).fill("20");
  await expect(page.getByRole("alert", { name: "Range errors" })).toContainText("overlaps");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Range errors" })).toContainText("overlaps");
  expect(state.getRecord()!.revision).toBe(1);
});

test("grouped treatment table preserves all seven editable scores", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("navigation", { name: "Scoring sections" }).getByRole("button", { name: /Treatment/ }).click();
  await page.locator("#final-field-treatment_status").getByRole("button").click();
  const editor = page.locator("#final-scoring-treatment_status");
  await expect(editor.getByRole("spinbutton")).toHaveCount(7);
  await expect(editor.getByText("Treatment choice", { exact: true })).toBeVisible();
  await editor.getByRole("spinbutton", { name: /With Cancer/ }).fill("4");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const field = state.getRecord()!.definition.sections.flatMap(section => section.fields).find(field => field.id === "treatment_status")!;
  expect(field.kind === "conditional" && field.scoring.palliative.paths.find(path => !path.children.length)!.points).toBe(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});


test("overlap feedback identifies rows without duplicate save errors", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Face scan", exact: true }).click();
  const saved = structuredClone(state.getRecord()!.definition.faceScanScoring);
  await page.getByLabel("From (%)", { exact: true }).nth(2).fill("60");
  const errors = page.getByRole("alert", { name: "Range errors" });
  await expect(errors).toContainText("Rows 1 and 3 overlap between 60% and 70%");
  await expect(errors).toContainText("Rows 2 and 3 overlap between 70% and 80%");
  await expect(errors).not.toContainText("include 100%");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByLabel("Configuration issues")).toHaveCount(0);
  await expect(errors).toBeFocused();
  expect(state.getRecord()!.definition.faceScanScoring).toEqual(saved);
  await page.getByLabel("From (%)", { exact: true }).nth(2).fill("80");
  await expect(errors).toHaveCount(0);
});


test("failed checks show a result without advancing the timeline", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  state.transitionError = "RULE_VALIDATION_FAILED";
  state.transitionIssues = [{ message: "The sample assessment score does not match the expected score." }];
  await page.getByRole("button", { name: "Check rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Checks failed");
  await expect(page.getByRole("dialog").getByRole("list", { name: "Reasons this action failed" })).toContainText("The sample assessment score does not match the expected score.");
  await page.getByRole("button", { name: "Review errors", exact: true }).click();
  await expect(page.getByRole("region", { name: "Version timeline" })).toContainText("Current: Draft");
  expect(state.getRecord()!.lifecycle).toBe("DRAFT");
});


test("editing a checked draft resets progress but retains history", async ({ page }) => {
  await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByRole("button", { name: "Check rules", exact: true }).click();
  await page.getByRole("button", { name: "Edit rules", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Scoring", exact: true })).toHaveAttribute("data-state", "active");
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Changed after checks");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const timeline = page.getByRole("region", { name: "Version timeline" });
  await expect(timeline).toContainText("Current: Draft");
  await expect(timeline.getByRole("list", { name: "Version stages" }).getByRole("listitem").nth(1)).toContainText("Not completed");
  await timeline.getByText("Activity history", { exact: true }).click();
  await expect(timeline).toContainText("Checks passed");
});

test("retirement requires confirmation and remains visible in history and filters", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByRole("button", { name: "Check rules", exact: true }).click();
  await page.getByRole("button", { name: "Continue to approval", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve version", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Retire version", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Move any deployments pinned to it");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.getRecord()!.lifecycle).toBe("APPROVED");
  await page.getByRole("button", { name: "Retire version", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Retire version", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Version retired");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(state.getRecord()!.lifecycle).toBe("RETIRED");
  await page.reload();
  await expect(page.getByRole("button", { name: "Retire version", exact: true })).toHaveCount(0);
  await page.getByText("Activity history", { exact: true }).click();
  await expect(page.getByText("Version retired", { exact: true })).toBeVisible();
  await page.goto("/versions");
  await page.getByRole("combobox", { name: "Filter by lifecycle" }).click();
  await page.getByRole("option", { name: "Retired", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Final assessment browser draft" })).toBeVisible();
});
