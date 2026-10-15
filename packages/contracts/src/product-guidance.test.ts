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
    expect(guidance.plans.every(plan => plan.source.location.startsWith("Product_mapping_!"))).toBe(true);
    expect(guidance.plans.map(plan => plan.durationAmount)).toEqual([15, 15, 15, 90, 90, 90, 365, 365, 365, 30, 30, 30]);
    expect(guidance.plans.every(plan => productPlanItems(plan).length > 0
      && productPlanItems(plan).every(item => item.quantityPerDay !== undefined))).toBe(true);
  });

  test("preserves workbook dose and the approved day equivalents for distinct stages", () => {
    const { plans, notes } = initialProductGuidance();
    expect(plans.find(plan => plan.stage === "pre_conditioning" && plan.nutritionalStatus === "well_nourished")?.duration)
      .toBe("15 days before treatment");
    expect(plans.find(plan => plan.stage === "during_treatment" && plan.nutritionalStatus === "severely_malnourished")?.dose)
      .toBe("3 Invigour + 2 Protect");
    expect(plans.find(plan => plan.stage === "surgical" && plan.nutritionalStatus === "severely_malnourished")?.dose)
      .toBe("1 Invigour + 2 Liss WH (level scoop)");
    expect(plans.find(plan => plan.stage === "during_treatment")?.duration).toBe("Minimum 90 days during treatment");
    expect(plans.find(plan => plan.stage === "post_treatment")?.duration).toBe("365 days or more after treatment");
    expect(new Set(notes.map(note => note.kind))).toEqual(new Set([
      "pancreatic_nourish_exclusion", "liver_nourish_once_daily", "surgery_done_liss",
      "surgery_planned_liss", "vegetarian_liss_substitution", "jain_liss_substitution",
    ]));
    expect(notes.find(note => note.kind === "surgery_planned_liss")?.guidance)
      .toContain("only after surgery");
  });

  test("reads simple legacy doses and round trips a structured product cart", () => {
    const plan = initialProductGuidance().plans.find(row => row.stage === "pre_conditioning" && row.nutritionalStatus === "moderately_nourished")!;
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
    expect(productIdentityName("Es Fortitude Protect")).toBe(productIdentityName("Protect"));
  });

  test("stores each workbook Surgical scoop count in the quantity field", () => {
    const surgical = initialProductGuidance().plans.filter(row => row.stage === "surgical");
    expect(surgical.map(row => row.items)).toEqual([
      [{ productName: "Liss WH", quantityPerDay: 1, unit: "level scoop", preparation: "Mix in 150 mL water." }],
      [{ productName: "Liss WH", quantityPerDay: 2, unit: "level scoop", preparation: "Mix in 150 mL water." }],
      [{ productName: "Invigour", quantityPerDay: 1 }, { productName: "Liss WH", quantityPerDay: 2, unit: "level scoop", preparation: "Mix in 150 mL water." }],
    ]);
    for (const plan of surgical) {
      expect(productPlanSnapshot(productPlanItems(plan)).dose).toBe(plan.dose);
      const legacy = { ...plan, items: undefined, productNames: undefined,
        dose: plan.nutritionalStatus === "well_nourished" ? "1 leveled scoops in 150ml water"
          : plan.nutritionalStatus === "moderately_nourished" ? "2 leveled scoops in 150ml water" : "1 Invigour + 2 leveled scoops in 150ml water" };
      expect(normalizeProductPlan(legacy)).toMatchObject({ items: plan.items, productNames: plan.productNames, dose: plan.dose });
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

  test("links workbook exceptions to their source rows and identifies the owner-approved Jain rule", () => {
    const locations = Object.fromEntries(initialProductGuidance().notes.map(note => [note.kind, note.source.location]));
    expect(locations).toEqual({
      pancreatic_nourish_exclusion: "Product_mapping_!A18:C18",
      liver_nourish_once_daily: "Product_mapping_!A19:C19",
      surgery_done_liss: "Product_mapping_!A21:D21",
      surgery_planned_liss: "Product_mapping_!A22:C22",
      vegetarian_liss_substitution: "Product_mapping_!A23:C23",
      jain_liss_substitution: "Product exceptions / Jain diet",
    });
  });

  test("copies the six existing product effects into structured default actions", () => {
    const notes = initialProductGuidance().notes;
    for (const note of notes) {
      expect(note.action).toEqual(defaultProductExceptionAction(note.kind));
    }
    expect(notes.find(note => note.kind === "pancreatic_nourish_exclusion")?.action).toEqual({
      type: "remove", productName: "Nourish",
    });
    expect(notes.find(note => note.kind === "surgery_done_liss")?.action).toEqual({ type: "use_plan", stage: "surgical" });
    expect(notes.find(note => note.kind === "vegetarian_liss_substitution")?.action).toEqual({
      type: "replace", productName: "Liss WH", replacementProductName: "Invigour", matchSourceQuantity: true,
    });
    expect(defaultProductExceptionAction("custom")).toBeNull();
  });

  test("accepts old rows and custom actions with an optional explanation", () => {
    const original = initialProductGuidance();
    const legacy = { ...original.notes[0]!, action: undefined };
    const custom = {
      ...legacy, id: "custom_exclusion", kind: "custom", guidance: "",
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
    expect(initialProductGuidance().plans[0]!.dose).toBe("1 Invigour + 1 Nourish");
    expect(initialProductGuidance().comorbidities[0]!.guidance).not.toBe("changed");
  });
});
