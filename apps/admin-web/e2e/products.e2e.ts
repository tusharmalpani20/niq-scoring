import { expect, test } from "@playwright/test";
import { mockFinalConsole, startFinalDraft } from "./final-assessment-fixture";

test("shared product names can be added and selected without changing saved rule snapshots", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await page.goto("/products");
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expect(page.getByText("Invigour", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Fortitude Plus");
  await page.getByRole("dialog").getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Fortitude Plus", { exact: true })).toBeVisible();

  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Care plan rules", exact: true }).click();
  await page.getByRole("button", { name: /Products & doses 12/ }).click();
  await expect(page.getByText("1 Invigour + 1 Nourish", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Before treatment · Well nourished" }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "Products in this rule" })).toBeVisible();
  await expect(editor.getByLabel("Invigour quantity")).toHaveValue("1");
  await expect(editor.getByLabel("Nourish quantity")).toHaveValue("1");
  await expect(editor.getByLabel("Duration (days)")).toHaveValue("15");
  await editor.getByRole("button", { name: "Add Fortitude Plus" }).click();
  await editor.getByLabel("Fortitude Plus quantity").fill("2");
  await editor.getByLabel("Fortitude Plus description").fill("After meals");
  await editor.getByRole("button", { name: "Remove Nourish" }).click();
  await editor.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("1 Invigour + 2 Fortitude Plus (After meals)")).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const plan = state.getRecord()?.definition.carePlanGuidance?.products.plans.find(row => row.id === "product_pre_conditioning_well_nourished");
  expect(plan?.productNames).toEqual(["Invigour", "Fortitude Plus"]);
  expect(plan?.products).toBe("Invigour + Fortitude Plus");
  expect(plan?.items).toEqual([{ productName: "Invigour", quantityPerDay: 1 }, { productName: "Fortitude Plus", quantityPerDay: 2, description: "After meals" }]);
  expect(plan?.dose).toBe("1 Invigour + 2 Fortitude Plus (After meals)");

  await page.goto("/products");
  await page.getByRole("button", { name: "Edit Fortitude Plus" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Fortitude X");
  await page.getByRole("dialog").getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Fortitude X", { exact: true })).toBeVisible();
  expect(plan?.products).toBe("Invigour + Fortitude Plus");
});

test("Surgical plans fill every quantity from the sheet's scoop counts", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Care plan rules", exact: true }).click();
  await page.getByRole("button", { name: /Products & doses 12/ }).click();
  await expect(page.getByText("1 Liss WH (leveled scoops in 150ml water)")).toBeVisible();
  await page.getByRole("button", { name: "Edit After surgery · Well nourished" }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByLabel("Liss WH quantity")).toHaveValue("1");
  await expect(editor.getByLabel("Liss WH description")).toHaveValue("leveled scoops in 150ml water");
  await editor.getByLabel("Duration (days)").fill("31");
  await editor.getByRole("button", { name: "Save rule" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const plan = () => state.getRecord()?.definition.carePlanGuidance?.products.plans.find(row => row.id === "product_surgical_well_nourished");
  expect(plan()?.dose).toBe("1 leveled scoops in 150ml water");
  expect(plan()?.items).toEqual([{ productName: "Liss WH", quantityPerDay: 1, description: "leveled scoops in 150ml water" }]);

  await page.getByRole("button", { name: "Edit After surgery · Well nourished" }).click();
  await editor.getByLabel("Liss WH quantity").fill("");
  await editor.getByRole("button", { name: "Save rule" }).click();
  await expect(editor.getByRole("alert")).toContainText("Enter a quantity from 1 to 100 for every product");
  await expect(editor.getByLabel("Liss WH quantity")).toHaveValue("");
  await editor.getByLabel("Liss WH quantity").fill("1");
  await editor.getByRole("button", { name: "Cancel" }).click();
});

test("replacement defaults to the replaced product quantity and can use a fixed quantity", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Care plan rules", exact: true }).click();
  await page.getByRole("button", { name: /Product exceptions 6/ }).click();
  await page.getByRole("button", { name: "Edit Vegetarian diet" }).click();
  const editor = page.getByRole("dialog");
  const matchQuantity = editor.getByRole("checkbox", { name: "Match the replaced product's daily quantity" });
  await expect(matchQuantity).toBeChecked();
  await expect(editor.getByLabel("Replacement quantity per day")).toHaveCount(0);
  await matchQuantity.uncheck();
  await editor.getByLabel("Replacement quantity per day").fill("2");
  await editor.getByRole("button", { name: "Save rule" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const action = state.getRecord()?.definition.carePlanGuidance?.products.notes.find(row => row.kind === "vegetarian_liss_substitution")?.action;
  expect(action).toMatchObject({ type: "replace", productName: "Liss WH", replacementProductName: "Invigour", matchSourceQuantity: false, replacementQuantityPerDay: 2 });
});

test("a new exception saves an assessment match and exact product change", async ({ page }) => {
  const state = await mockFinalConsole(page);
  await startFinalDraft(page);
  await page.getByRole("tab", { name: "Care plan rules", exact: true }).click();
  await page.getByRole("button", { name: /Product exceptions 6/ }).click();
  await page.getByRole("button", { name: "Add rule" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Rule name").fill("Protect for selected cancer");
  await editor.getByLabel("Answer").click();
  await page.getByRole("option", { name: "Head & Neck cancer" }).click();
  await editor.getByLabel("Action").click();
  await page.getByRole("option", { name: "Recommend a product" }).click();
  await editor.getByRole("combobox", { name: "Product", exact: true }).click();
  await page.getByRole("option", { name: "Protect", exact: true }).click();
  await editor.getByLabel("Quantity per day").fill("2");
  await expect(editor.getByText(/When Type of cancer is .*recommend Protect at 2 per day/)).toBeVisible();
  await editor.getByRole("button", { name: "Save rule" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.getRecord()?.definition.carePlanGuidance?.products.notes).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "custom", label: "Protect for selected cancer",
      match: { fieldId: "cancer_type", optionId: "cancer_7" },
      action: { type: "recommend", productName: "Protect", quantityPerDay: 2 } }),
  ]));
});
