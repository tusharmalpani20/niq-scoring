import { describe, expect, test } from "bun:test";
import { initialProductGuidance, productGuidanceSchema } from "./product-guidance-template";
import { defaultProductExceptionAction, productPlanItemSchema, normalizeProductDuration, normalizeProductPlan, productDurationDays, productIdentityName, productPlanItems, productPlanSnapshot } from "./product-guidance";

describe("product workbook defaults", () => {
  test("covers every stage and nutritional-status combination once", () => {
    const guidance = initialProductGuidance();
    expect(productGuidanceSchema.safeParse(guidance).success).toBe(true);
    expect(guidance.plans).toHaveLength(12);
    expect(new Set(guidance.plans.map(plan => `${plan.stage}:${plan.nutritionalStatus}`)).size).toBe(12);
    expect(new Set(guidance.plans.map(plan => plan.stage))).toEqual(new Set([
      "pre_conditioning", "during_treatment", "post_treatment", "surgical",
    ]));
    expect(new Set(guidance.plans.map(plan => plan.nutritionalStatus))).toEqual(new Set([
      "well_nourished", "moderately_nourished", "severely_malnourished",
    ]));
    expect(guidance.plans.map(plan => plan.source.location)).toEqual(
      [2, 3, 4, 7, 8, 9, 11, 12, 13, 15, 16, 17].map(row => `Sheet1!A${row}:G${row}`),
    );
    expect(guidance.plans.map(plan => plan.durationAmount)).toEqual([15, 15, 15, 90, 90, 90, 365, 365, 365, 30, 30, 30]);
    expect(guidance.plans.every(plan => productPlanItems(plan).length > 0
      && productPlanItems(plan).every(item => item.quantityPerDay !== undefined))).toBe(true);
  });

  test("preserves workbook dose and the approved day equivalents for distinct stages", () => {
    const { plans, notes, surgicalEligibilityDays } = initialProductGuidance();
    expect(surgicalEligibilityDays).toBe(7);
    expect(plans.find(plan => plan.stage === "pre_conditioning" && plan.nutritionalStatus === "well_nourished")?.duration)
      .toBe("15 days before treatment");
    expect(plans.find(plan => plan.stage === "during_treatment" && plan.nutritionalStatus === "severely_malnourished")?.items)
      .toMatchObject([
        { productName: "Es-Invigour", quantityPerDay: 2, unit: "sachet", mealTiming: "1 after breakfast and 1 after lunch." },
        { productName: "Es Fortitude Protect", quantityPerDay: 2, unit: "sachet", mealTiming: "1 at evening snack time and 1 after dinner." },
      ]);
    expect(plans.find(plan => plan.stage === "surgical" && plan.nutritionalStatus === "severely_malnourished")?.dose)
      .toBe("1 Es-Invigour (sachet) + 2 Liss WH (level scoop)");
    expect(plans.find(plan => plan.stage === "during_treatment")?.duration).toBe("Minimum 90 days during treatment");
    expect(plans.find(plan => plan.stage === "post_treatment")?.duration).toBe("365 days or more after treatment");
    expect(new Set(notes.map(note => note.kind))).toEqual(new Set([
      "pancreatic_nourish_exclusion", "liver_nourish_once_daily", "surgery_done_liss",
      "surgery_planned_liss", "vegetarian_liss_substitution", "jain_liss_substitution", "custom",
    ]));
    expect(notes.find(note => note.kind === "surgery_planned_liss")?.guidance)
      .toContain("only after surgery");
  });

  test("reads simple legacy doses and round trips a structured product cart", () => {
    const plan = { ...initialProductGuidance().plans[1]!, items: undefined, productNames: undefined,
      products: "Invigour + Nourish", dose: "1 Invigour + 2 Nourish" };
    expect(productPlanItems(plan)).toEqual([
      { productName: "Invigour", quantityPerDay: 1 },
      { productName: "Nourish", quantityPerDay: 2 },
    ]);
    const snapshot = productPlanSnapshot(productPlanItems(plan));
    expect(snapshot).toEqual({
      items: [{ productName: "Invigour", quantityPerDay: 1 }, { productName: "Nourish", quantityPerDay: 2 }],
      productNames: ["Invigour", "Nourish"], products: "Invigour + Nourish", dose: "1 Invigour + 2 Nourish",
    });
    expect(productGuidanceSchema.safeParse({ ...initialProductGuidance(), plans: [{ ...plan, ...snapshot }] }).success).toBe(true);
    expect(productPlanSnapshot([{ productName: "Liss WH", quantityPerDay: 2, unit: "level scoop", preparation: "Mix in 150 mL water." }])).toMatchObject({
      dose: "2 Liss WH (level scoop)", items: [{ productName: "Liss WH", quantityPerDay: 2, unit: "level scoop", preparation: "Mix in 150 mL water." }],
    });
  });

  test("keeps rule-specific schedule fields through a plan snapshot", () => {
    const plan = initialProductGuidance().plans.find(row => row.stage === "during_treatment" && row.nutritionalStatus === "moderately_nourished")!;
    const items = [{ productName: "Es Invigour", quantityPerDay: 1, unit: "sachet", timesPerDay: 1,
      preparation: "Mix in water and consume immediately", mealTiming: "After breakfast" },
    { productName: "Es Fortitude Protect", quantityPerDay: 2, unit: "sachets" }];
    const snapshot = productPlanSnapshot(items);
    const versioned = { ...plan, ...snapshot };
    expect(productGuidanceSchema.safeParse({ ...initialProductGuidance(), plans: [versioned] }).success).toBe(true);
    expect(productPlanItems(versioned)).toEqual(items);
    expect(versioned.durationAmount).toBe(90);
    expect(productIdentityName("Es Invigour")).toBe(productIdentityName("Invigour"));
    expect(productIdentityName("Es-Invigour")).toBe(productIdentityName("Invigour"));
    expect(productIdentityName("Es Fortitude Nourish")).toBe(productIdentityName("Nourish"));
    expect(productIdentityName("Es Fortitude Recover")).toBe(productIdentityName("Recover"));
    expect(productIdentityName("Es Fortitude Protect")).toBe(productIdentityName("Protect"));
  });

  test("stores each workbook Surgical scoop count in the quantity field", () => {
    const surgical = initialProductGuidance().plans.filter(row => row.stage === "surgical");
    const liss = surgical.map(row => row.items?.find(item => item.productName === "Liss WH"));
    expect(liss.map(item => item?.quantityPerDay)).toEqual([1, 2, 2]);
    expect(liss.map(item => item?.mealTiming)).toEqual(["After breakfast.", "After breakfast.", "After lunch."]);
    for (const [index, plan] of surgical.entries()) {
      expect(liss[index]).toMatchObject({ unit: "level scoop", timesPerDay: 1, preparation: "Mix in 150 mL water." });
      expect(productPlanSnapshot(productPlanItems(plan)).dose).toBe(plan.dose);
      const legacy = { ...plan, items: undefined, productNames: undefined,
        products: index === 2 ? "Invigour + Liss WH" : "Liss WH",
        dose: plan.nutritionalStatus === "well_nourished" ? "1 leveled scoops in 150ml water"
          : plan.nutritionalStatus === "moderately_nourished" ? "2 leveled scoops in 150ml water" : "1 Invigour + 2 leveled scoops in 150ml water" };
      expect(normalizeProductPlan(legacy)).toMatchObject({
        productNames: index === 2 ? ["Invigour", "Liss WH"] : ["Liss WH"],
        dose: `${index === 2 ? "1 Invigour + " : ""}${index === 0 ? 1 : 2} Liss WH (level scoop)`,
      });
    }
  });

  test("removes obsolete plan fields while retaining Liss WH serving details", () => {
    const item = productPlanItemSchema.parse({ productName: "Liss WH", quantityPerDay: 2,
      description: "leveled scoops in 150ml water", rationale: "Unused explanation" });
    expect(item).toEqual({ productName: "Liss WH", quantityPerDay: 2, unit: "level scoop", preparation: "Mix in 150 mL water." });
    expect(productPlanItems({ ...initialProductGuidance().plans[0]!, items: [item] })).toEqual([item]);
  });

  test("structured quantities must be positive whole numbers in a bounded range", () => {
    const original = initialProductGuidance();
    const plan = original.plans[0]!;
    for (const quantityPerDay of [0, -1, 1.5, 101]) {
      const snapshot = productPlanSnapshot([{ productName: "Invigour", quantityPerDay }]);
      const guidance = { ...original, plans: [{ ...plan, ...snapshot }] };
      expect(productGuidanceSchema.safeParse(guidance).success).toBe(false);
    }
  });

  test("upgrades known month durations in editable older drafts without guessing a custom conversion", () => {
    const during = initialProductGuidance().plans.find(plan => plan.stage === "during_treatment")!;
    const post = initialProductGuidance().plans.find(plan => plan.stage === "post_treatment")!;
    const oldDuring = { ...during, durationAmount: 3, duration: "Minimum 3 months during treatment" };
    const oldPost = { ...post, durationAmount: 12, duration: "12 month or more" };
    expect(normalizeProductDuration(oldDuring)).toMatchObject({ durationAmount: 90, duration: "Minimum 90 days during treatment" });
    expect(normalizeProductDuration(oldPost)).toMatchObject({ durationAmount: 365, duration: "365 days or more after treatment" });
    expect(normalizeProductDuration({ ...oldDuring, durationAmount: undefined })).toMatchObject({ durationAmount: 90 });
    expect(normalizeProductDuration({ ...oldPost, durationAmount: undefined })).toMatchObject({ durationAmount: 365 });
    expect(productDurationDays({ ...oldDuring, durationAmount: 4, duration: "Minimum 4 months during treatment" })).toBeNull();
  });

  test("maps all five workbook conditions to assessment option IDs without releasing named-drug source text", () => {
    const { comorbidities } = initialProductGuidance();
    expect(new Set(comorbidities.map(row => row.conditionId))).toEqual(new Set([
      "co_morbidities_diabetes", "co_morbidities_hypertension", "co_morbidities_liver_disease", "co_morbidities_kidney_disease", "co_morbidities_thyroid_disorder",
    ]));
    const sourceText = comorbidities.map(row => row.sourceText).join("\n");
    const reportText = comorbidities.map(row => row.guidance).join("\n");
    expect(sourceText).toContain("dexamethasone");
    expect(sourceText).toContain("bevacizumab");
    expect(sourceText).toContain("sunitinib");
    expect(reportText).not.toMatch(/dexamethasone|prednisone|bevacizumab|sorafenib|sunitinib|imatinib|metformin|SGLT2/i);
    const hypertension = comorbidities.find(row => row.conditionId === "co_morbidities_hypertension")!;
    expect(hypertension.sourceText).toContain("2.5-3lit of fluid intake per day");
    expect(hypertension.guidance).not.toContain("2.5-3lit of fluid intake per day");
    expect(hypertension.guidance).toContain("Check and record BP at home during treatment");
  });

  test("links the active workbook exceptions to their source rows", () => {
    const locations = Object.fromEntries(initialProductGuidance().notes.map(note => [note.kind, note.source.location]));
    expect(locations).toEqual({
      pancreatic_nourish_exclusion: "Sheet1!C23",
      liver_nourish_once_daily: "Sheet1!C24",
      surgery_done_liss: "Sheet1!C26:D26",
      surgery_planned_liss: "Sheet1!C27",
      vegetarian_liss_substitution: "Sheet1!C28",
      jain_liss_substitution: "Product exceptions / Jain diet",
      custom: "Sheet1!E24",
    });
  });

  test("seeds the reviewed product exceptions while retaining the legacy action lookup", () => {
    const notes = initialProductGuidance().notes;
    expect(notes.find(note => note.kind === "pancreatic_nourish_exclusion")?.action).toEqual({
      type: "remove", productName: "Es Fortitude Nourish",
    });
    expect(notes.find(note => note.kind === "surgery_done_liss")?.action).toEqual({ type: "use_plan", stage: "surgical" });
    expect(notes.find(note => note.kind === "vegetarian_liss_substitution")?.action).toMatchObject({
      type: "replace", productName: "Liss WH", replacementProductName: "Es-Invigour", replacementQuantityPerDay: 2, unit: "sachet",
    });
    expect(notes.find(note => note.kind === "jain_liss_substitution")?.enabled).toBe(false);
    expect(notes.find(note => note.id === "blood_cancer_protect_replacement")).toMatchObject({
      match: { fieldId: "cancer_type", optionId: "cancer_19" },
      action: { type: "replace", productName: "Es Fortitude Protect", replacementQuantityPerDay: 2, unit: "sachet", timesPerDay: 2 },
    });
    expect(defaultProductExceptionAction("vegetarian_liss_substitution")).toMatchObject({ matchSourceQuantity: true });
    expect(defaultProductExceptionAction("custom")).toBeNull();
  });

  test("accepts old rows and custom actions with an optional explanation", () => {
    const original = initialProductGuidance();
    const legacy = { ...original.notes[0]!, action: undefined };
    const custom = {
      ...legacy, id: "custom_exclusion", kind: "custom", guidance: "",
      match: { fieldId: "cancer_type", optionId: "cancer_6" },
      action: { type: "recommend", productName: "Invigour", quantityPerDay: 2 },
    };
    expect(productGuidanceSchema.safeParse({ ...original, notes: [legacy] }).success).toBe(true);
    expect(productGuidanceSchema.safeParse({ ...original, notes: [custom] }).success).toBe(true);
    expect(productGuidanceSchema.safeParse({ ...original, notes: [{ ...custom, match: undefined }] }).success).toBe(false);
    expect(productGuidanceSchema.safeParse({ ...original, notes: [{ ...legacy, guidance: "" }] }).success).toBe(false);
  });

  test("rejects incomplete or unbounded structured product actions", () => {
    const original = initialProductGuidance();
    const note = { ...original.notes[0]!, kind: "custom", guidance: "" };
    const invalidActions = [
      { type: "recommend", productName: "Invigour", quantityPerDay: 0 },
      { type: "recommend", productName: "Invigour", quantityPerDay: 1.5 },
      { type: "recommend", productName: "Invigour", quantityPerDay: 101 },
      { type: "remove", productName: "" },
      { type: "limit", productName: "Nourish", maxQuantityPerDay: 0 },
      { type: "replace", productName: "Liss WH", replacementProductName: "Invigour", replacementQuantityPerDay: 101 },
      { type: "replace", productName: "Liss WH", replacementProductName: "Invigour", matchSourceQuantity: true, replacementQuantityPerDay: 2 },
      { type: "delay", productName: "Liss WH", until: "unknown_event" },
      { type: "use_plan", stage: "unknown_stage" },
      { type: "recommend", productName: "", quantityPerDay: 1 },
      { type: "recommend", productName: "x".repeat(121), quantityPerDay: 1 },
    ];
    for (const action of invalidActions) {
      expect(productGuidanceSchema.safeParse({ ...original, notes: [{ ...note, action }] }).success).toBe(false);
    }
  });

  test("returns independent editable copies", () => {
    const first = initialProductGuidance();
    first.plans[0]!.dose = "changed";
    first.comorbidities[0]!.guidance = "changed";
    expect(initialProductGuidance().plans[0]!.dose).toBe("1 Es-Invigour (sachet) + 1 Es Fortitude Nourish (sachet)");
    expect(initialProductGuidance().comorbidities[0]!.guidance).not.toBe("changed");
  });
});
