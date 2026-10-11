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
    expect(result.treatmentGuidance).toMatchObject([{ treatmentTypeId: "current_cancer_treatment_radiation", nutritionalStatus: "moderately_nourished" }]);
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

  test("matches added treatment guidance only for its treatment and nutrition status", () => {
    const rule = definition();
    rule.carePlanGuidance!.oncology.radiotherapy.push({
      id: "immunotherapy_moderately_nourished",
      treatmentTypeId: "current_cancer_treatment_immunotherapy",
      nutritionalStatus: "moderately_nourished",
      guidance: "Clinician-approved immunotherapy nutrition guidance.",
      enabled: true,
      source: { document: "Manual entry", location: "Rules editor", note: "" },
    });
    expect(validateFinalAssessmentDefinition(rule)).toEqual([]);
    expect(resolveCarePlanGuidance(rule, base).treatmentGuidance).toEqual([]);
    expect(resolveCarePlanGuidance(rule, { ...base, treatmentTypeIds: ["current_cancer_treatment_immunotherapy"] }).treatmentGuidance)
      .toMatchObject([{ id: "immunotherapy_moderately_nourished" }]);
    expect(resolveCarePlanGuidance(rule, { ...base, riskCategoryId: "low", treatmentTypeIds: ["current_cancer_treatment_immunotherapy"] }).treatmentGuidance).toEqual([]);
    rule.carePlanGuidance!.oncology.radiotherapy.push({ ...rule.carePlanGuidance!.oncology.radiotherapy.at(-1)!, id: "duplicate_immunotherapy" });
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("DUPLICATE_TREATMENT_GUIDANCE");
  });

  test("keeps older radiotherapy rules attached to Radiation Therapy", () => {
    const rule = definition();
    delete rule.carePlanGuidance!.oncology.radiotherapy[1]!.treatmentTypeId;
    expect(validateFinalAssessmentDefinition(rule)).toEqual([]);
    const result = resolveCarePlanGuidance(rule, { ...base, treatmentTypeIds: ["current_cancer_treatment_radiation"] });
    expect(result.treatmentGuidance).toMatchObject([{ id: "radiotherapy_moderately_nourished", treatmentTypeId: "current_cancer_treatment_radiation" }]);
    expect(resolveCarePlanGuidance(rule, base).treatmentGuidance).toEqual([]);
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

  test("only emits Liss WH surgery advice when the selected plan and diet permit it", () => {
    const rule = definition();
    const surgery: CarePlanFacts = { ...base, surgicalStatusId: "cancer_surgical_status_done", surgeryDate: "2026-10-08" };
    const unknownDiet = resolveCarePlanGuidance(rule, surgery).products;
    expect(unknownDiet.status).toBe("facts_required");
    expect(unknownDiet.notes.map(row => row.kind)).not.toContain("surgery_done_liss");

    const vegetarian = resolveCarePlanGuidance(rule, { ...surgery, dietPreferenceId: "vegetarian" }).products;
    expect(vegetarian.status).toBe("clinician_choice_required");
    expect(vegetarian.notes.map(row => row.kind)).toEqual(["vegetarian_liss_substitution"]);
    const jain = resolveCarePlanGuidance(rule, { ...surgery, dietPreferenceId: "jain" }).products;
    expect(jain.status).toBe("clinician_choice_required");
    expect(jain.notes.map(row => row.kind)).not.toContain("surgery_done_liss");

    const confirmed = resolveCarePlanGuidance(rule, { ...surgery, dietPreferenceId: "non_vegetarian" }).products;
    expect(confirmed.notes.map(row => row.kind)).toContain("surgery_done_liss");
    rule.carePlanGuidance!.surgicalOverlapPolicy = "clinician_choice";
    const overlap = { ...surgery, treatmentStatusId: "treatment_status_under_treatment", dietPreferenceId: "non_vegetarian" };
    expect(resolveCarePlanGuidance(rule, overlap).products.notes.map(row => row.kind)).not.toContain("surgery_done_liss");
    expect(resolveCarePlanGuidance(rule, { ...overlap, productStageChoice: "treatment_stage" }).products.notes.map(row => row.kind))
      .not.toContain("surgery_done_liss");
    expect(resolveCarePlanGuidance(rule, { ...overlap, productStageChoice: "surgical" }).products.notes.map(row => row.kind))
      .toContain("surgery_done_liss");

    const planned: CarePlanFacts = { ...base, surgicalStatusId: "cancer_surgical_status_planned", plannedSurgeryDate: "2026-10-14" };
    expect(resolveCarePlanGuidance(rule, planned).products.notes.map(row => row.kind)).not.toContain("surgery_planned_liss");
    expect(resolveCarePlanGuidance(rule, { ...planned, dietPreferenceId: "vegetarian" }).products.notes.map(row => row.kind))
      .not.toContain("surgery_planned_liss");
    expect(resolveCarePlanGuidance(rule, { ...planned, dietPreferenceId: "non_vegetarian" }).products.notes.map(row => row.kind))
      .toContain("surgery_planned_liss");
  });

  test("Other receives only the existing generic nutrition layer", () => {
    const result = resolveCarePlanGuidance(definition(), { ...base, drugClassIds: ["other"],
      coMorbidityIds: ["co_morbidities_diabetes"], treatmentStatusId: "treatment_status_under_treatment" });
    expect(result).toEqual({ nutritionalStatus: null, statusModifiers: [], treatmentGuidance: [], coMorbidities: [],
      products: { status: "none", plans: [], notes: [] } });
  });
});
