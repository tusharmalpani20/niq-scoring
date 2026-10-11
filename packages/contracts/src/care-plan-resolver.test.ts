import { describe, expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "./final-assessment-template";
import { validateFinalAssessmentDefinition } from "./final-assessment-validation";
import { resolveCarePlanGuidance, type CarePlanFacts } from "./care-plan-resolver";
import { publicQuestionnaire } from "./rule-public";

const definition = () => createFinalAssessmentTemplate("Care plan");
const base: CarePlanFacts = {
  riskCategoryId: "moderate",
  drugClassIds: ["taxanes"],
  treatmentTypeIds: ["current_cancer_treatment_chemotherapy"],
  coMorbidityIds: [],
  asOfDate: "2026-10-11",
};

describe("care plan guidance from the versioned workbooks", () => {
  test("maps stable risk IDs and matches class, radiotherapy and co-morbidity guidance", () => {
    const rule = definition();
    rule.riskCategories.find(row => row.id === "moderate")!.label = "Needs support";
    const result = resolveCarePlanGuidance(rule, {
      ...base,
      treatmentTypeIds: ["current_cancer_treatment_chemotherapy", "current_cancer_treatment_radiation"],
      coMorbidityIds: ["co_morbidities_diabetes"],
    });
    expect(result.nutritionalStatus).toBe("moderately_nourished");
    expect(result.statusModifiers.map(row => row.id)).toEqual(["status_taxanes_moderately_nourished"]);
    expect(result.radiotherapy).toHaveLength(1);
    expect(result.coMorbidities.map(row => row.conditionId)).toEqual(["co_morbidities_diabetes"]);
    expect(JSON.stringify(result.coMorbidities)).not.toContain("dexamethasone");
    expect(result.coMorbidities[0]).not.toHaveProperty("sourceText");
    expect(validateFinalAssessmentDefinition(rule)).toEqual([]);
    expect(JSON.stringify(publicQuestionnaire(rule))).not.toContain("Liss WH");
    expect(JSON.stringify(publicQuestionnaire(rule))).not.toContain("status_taxanes");
  });

  test("new risk categories require an explicit nutrition-status mapping", () => {
    const rule = definition();
    rule.riskCategories.push({ id: "custom", label: "Custom", color: "blue", interpretation: "", min: 100, max: null, minInclusive: true, maxInclusive: true, sources: [] });
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("MISSING_RISK_STATUS_MAPPING");
  });

  test("selects one matching product plan and requires dates for time-bound stages", () => {
    const rule = definition();
    expect(resolveCarePlanGuidance(rule, { ...base, treatmentStatusId: "treatment_status_newly_diagnosed" }).products).toMatchObject({
      status: "facts_required",
      plans: [],
    });
    const before = resolveCarePlanGuidance(rule, { ...base, treatmentStatusId: "treatment_status_newly_diagnosed",
      plannedTreatmentStartDate: "2026-10-20", cancerTypeId: "cancer_1" });
    expect(before.products).toMatchObject({ status: "selected", plans: [{ id: "product_pre_conditioning_moderately_nourished" }] });
    const during = resolveCarePlanGuidance(rule, { ...base, treatmentStatusId: "treatment_status_under_treatment" });
    expect(during.products).toMatchObject({ status: "selected", plans: [{ id: "product_during_treatment_moderately_nourished" }] });
    expect(resolveCarePlanGuidance(rule, { ...base, treatmentStatusId: "treatment_status_palliative_care" }).products.plans).toEqual([]);
  });

  test("handles Surgical overlap without combining product doses", () => {
    const rule = definition();
    const facts: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_under_treatment",
      surgicalStatusId: "cancer_surgical_status_done", surgeryDate: "2026-10-08", dietPreferenceId: "non_vegetarian" };
    expect(resolveCarePlanGuidance(rule, facts).products).toMatchObject({ status: "selected", plans: [{ stage: "surgical" }] });
    rule.carePlanGuidance!.surgicalOverlapPolicy = "clinician_choice";
    const choice = resolveCarePlanGuidance(rule, facts).products;
    expect(choice).toMatchObject({ status: "clinician_choice_required", plans: [] });
    expect(choice.choices?.map(plan => plan.stage).sort()).toEqual(["during_treatment", "surgical"]);
    expect(resolveCarePlanGuidance(rule, { ...facts, productStageChoice: "treatment_stage" }).products)
      .toMatchObject({ status: "selected", plans: [{ stage: "during_treatment" }] });
    expect(resolveCarePlanGuidance(rule, { ...facts, productStageChoice: "surgical" }).products)
      .toMatchObject({ status: "selected", plans: [{ stage: "surgical" }] });
  });

  test("withholds product doses when a workbook exception needs adjustment", () => {
    const rule = definition();
    const pre: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_newly_diagnosed",
      plannedTreatmentStartDate: "2026-10-20" };
    expect(resolveCarePlanGuidance(rule, pre).products.status).toBe("facts_required");
    expect(resolveCarePlanGuidance(rule, { ...pre, cancerTypeId: "cancer_6" }).products).toMatchObject({
      status: "clinician_choice_required", plans: [],
    });
    expect(resolveCarePlanGuidance(rule, { ...pre, cancerTypeId: "cancer_5" }).products).toMatchObject({
      status: "clinician_choice_required", plans: [],
    });
    const surgery: CarePlanFacts = { ...base, surgicalStatusId: "cancer_surgical_status_done", surgeryDate: "2026-10-08" };
    expect(resolveCarePlanGuidance(rule, surgery).products.status).toBe("facts_required");
    expect(resolveCarePlanGuidance(rule, { ...surgery, dietPreferenceId: "vegetarian" }).products).toMatchObject({
      status: "clinician_choice_required", plans: [],
    });
    expect(resolveCarePlanGuidance(rule, { ...surgery, dietPreferenceId: "non_vegetarian" }).products.plans[0]?.stage).toBe("surgical");
  });

  test("Other receives only the existing generic nutrition layer", () => {
    const result = resolveCarePlanGuidance(definition(), { ...base, drugClassIds: ["other"],
      coMorbidityIds: ["co_morbidities_diabetes"], treatmentStatusId: "treatment_status_under_treatment" });
    expect(result).toEqual({ nutritionalStatus: null, statusModifiers: [], radiotherapy: [], coMorbidities: [],
      products: { status: "none", plans: [], notes: [] } });
  });
});
