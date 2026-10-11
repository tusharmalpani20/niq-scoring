import { describe, expect, test } from "bun:test";
import { initialProductGuidance, productGuidanceSchema } from "./product-guidance-template";

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
  });

  test("preserves workbook dose and timing for distinct stages", () => {
    const { plans, notes } = initialProductGuidance();
    expect(plans.find(plan => plan.stage === "pre_conditioning" && plan.nutritionalStatus === "well_nourished")?.duration)
      .toBe("15 days before treatment");
    expect(plans.find(plan => plan.stage === "during_treatment" && plan.nutritionalStatus === "severely_malnourished")?.dose)
      .toBe("3 Invigour + 2 Protect");
    expect(plans.find(plan => plan.stage === "surgical" && plan.nutritionalStatus === "severely_malnourished")?.dose)
      .toBe("1 Invigour + 2 leveled scoops in 150ml water");
    expect(new Set(notes.map(note => note.kind))).toEqual(new Set([
      "pancreatic_nourish_exclusion", "liver_nourish_once_daily", "surgery_done_liss",
      "surgery_planned_liss", "vegetarian_liss_substitution",
    ]));
    expect(notes.find(note => note.kind === "surgery_planned_liss")?.guidance)
      .toContain("only after surgery");
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

  test("links each product exception to its actual workbook row", () => {
    const locations = Object.fromEntries(initialProductGuidance().notes.map(note => [note.kind, note.source.location]));
    expect(locations).toEqual({
      pancreatic_nourish_exclusion: "Product_mapping_!A18:C18",
      liver_nourish_once_daily: "Product_mapping_!A19:C19",
      surgery_done_liss: "Product_mapping_!A21:D21",
      surgery_planned_liss: "Product_mapping_!A22:C22",
      vegetarian_liss_substitution: "Product_mapping_!A23:C23",
    });
  });

  test("returns independent editable copies", () => {
    const first = initialProductGuidance();
    first.plans[0]!.dose = "changed";
    first.comorbidities[0]!.guidance = "changed";
    expect(initialProductGuidance().plans[0]!.dose).toBe("1 Invigour + 1 Nourish");
    expect(initialProductGuidance().comorbidities[0]!.guidance).not.toBe("changed");
  });
});
