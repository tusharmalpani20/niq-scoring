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

  test("uses selected catalogue names for exceptions without confusing similar products", () => {
    const rule = definition();
    const plan = rule.carePlanGuidance!.products.plans.find(row => row.stage === "pre_conditioning" && row.nutritionalStatus === "moderately_nourished")!;
    plan.productNames = ["Invigour", "Nourish Plus"];
    plan.products = "Invigour + Nourish Plus";
    plan.dose = "1 Invigour + 1 Nourish Plus";
    expect(validateFinalAssessmentDefinition(rule)).toEqual([]);
    const result = resolveCarePlanGuidance(rule, { ...base, treatmentStatusId: "treatment_status_newly_diagnosed", plannedTreatmentStartDate: "2026-10-20" });
    expect(result.products).toMatchObject({ status: "selected", plans: [{ products: "Invigour + Nourish Plus" }] });
    plan.products = "Nourish Plus";
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("INVALID_PRODUCT_SELECTION");
  });

  test("full PDF names and workbook shorthands remain one product identity", () => {
    const rule = definition();
    const plan = rule.carePlanGuidance!.products.plans.find(row => row.stage === "during_treatment" && row.nutritionalStatus === "moderately_nourished")!;
    plan.items = [{ productName: "Es Invigour", quantityPerDay: 1 }, { productName: "Es Fortitude Protect", quantityPerDay: 2 }];
    plan.productNames = plan.items.map(item => item.productName);
    plan.products = plan.productNames.join(" + ");
    plan.dose = "1 Es Invigour + 2 Es Fortitude Protect";
    expect(validateFinalAssessmentDefinition(rule)).toEqual([]);
    const result = resolveCarePlanGuidance(rule, { ...base, treatmentStatusId: "treatment_status_under_treatment" });
    expect(result.products.plans[0]?.items).toEqual(plan.items);
    plan.items.push({ productName: "Protect", quantityPerDay: 1 });
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("DUPLICATE_PRODUCT_ITEM");
  });

  test("validates the cart against saved product and dose snapshots", () => {
    const rule = definition();
    const plan = rule.carePlanGuidance!.products.plans[0]!;
    plan.items = [{ productName: "Invigour", quantityPerDay: 1 }, { productName: "Nourish", quantityPerDay: 1 }];
    plan.productNames = ["Invigour", "Nourish"];
    expect(validateFinalAssessmentDefinition(rule)).toEqual([]);
    delete plan.items[1]!.quantityPerDay;
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("MISSING_PRODUCT_QUANTITY");
    plan.items[1]!.quantityPerDay = 2;
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("INVALID_PRODUCT_SNAPSHOT");
    plan.dose = "1 Invigour + 2 Nourish";
    plan.items.push({ productName: "nourish", quantityPerDay: 1 });
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("DUPLICATE_PRODUCT_ITEM");
  });

  test("requires quantities when an older product plan has only unstructured dose text", () => {
    const rule = definition();
    const plan = rule.carePlanGuidance!.products.plans[0]!;
    delete plan.items;
    plan.dose = "As directed";
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("MISSING_PRODUCT_QUANTITY");
  });

  test("uses exact structured quantities for the once-daily Nourish limit", () => {
    const rule = definition();
    const plan = rule.carePlanGuidance!.products.plans.find(row => row.stage === "pre_conditioning" && row.nutritionalStatus === "moderately_nourished")!;
    plan.items = [{ productName: "Invigour", quantityPerDay: 1 }, { productName: "Nourish", quantityPerDay: 4 }];
    plan.productNames = ["Invigour", "Nourish"];
    plan.dose = "1 Invigour + 4 Nourish";
    const facts: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_newly_diagnosed",
      plannedTreatmentStartDate: "2026-10-20", cancerTypeId: "cancer_5" };
    expect(resolveCarePlanGuidance(rule, facts).products).toMatchObject({
      status: "selected", plans: [{ items: [{ productName: "Invigour", quantityPerDay: 1 }, { productName: "Nourish", quantityPerDay: 1 }] }],
    });
  });

  test("uses the rule's numeric durations and calculates windows from assessment and event dates", () => {
    const rule = definition();
    const pre = rule.carePlanGuidance!.products.plans.find(row => row.stage === "pre_conditioning" && row.nutritionalStatus === "moderately_nourished")!;
    expect(pre.durationAmount).toBe(15);
    const preFacts: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_newly_diagnosed", plannedTreatmentStartDate: "2026-10-20", cancerTypeId: "cancer_1" };
    expect(resolveCarePlanGuidance(rule, preFacts).products.plans[0]?.duration).toBe("15 days before treatment (2026-10-05 to 2026-10-19, with treatment planned for 2026-10-20)");
    pre.durationAmount = 8;
    expect(resolveCarePlanGuidance(rule, preFacts).products.plans).toEqual([]);
    expect(resolveCarePlanGuidance(rule, { ...preFacts, asOfDate: "2026-10-12" }).products.plans[0]?.duration)
      .toBe("8 days before treatment (2026-10-12 to 2026-10-19, with treatment planned for 2026-10-20)");

    const surgical = rule.carePlanGuidance!.products.plans.find(row => row.stage === "surgical" && row.nutritionalStatus === "moderately_nourished")!;
    surgical.durationAmount = 5;
    const surgeryFacts: CarePlanFacts = { ...base, treatmentStatusId: null, surgicalStatusId: "cancer_surgical_status_done", surgeryDate: "2026-10-06", dietPreferenceId: "non_vegetarian" };
    expect(resolveCarePlanGuidance(rule, surgeryFacts).products.plans[0]?.duration).toBe("5 days after surgery (through 2026-10-11)");
    expect(resolveCarePlanGuidance(rule, { ...surgeryFacts, asOfDate: "2026-10-12" }).products.plans).toEqual([]);
    delete surgical.durationAmount;
    expect(resolveCarePlanGuidance(rule, surgeryFacts).products.plans[0]?.duration).toBe("30 days after surgery (through 2026-11-05)");
  });

  test("pinned older month wording remains unchanged until an editable draft is saved in days", () => {
    const rule = definition();
    const during = rule.carePlanGuidance!.products.plans.find(row => row.stage === "during_treatment" && row.nutritionalStatus === "moderately_nourished")!;
    during.duration = "Minimum 3 months during treatment";
    delete during.durationAmount;
    expect(resolveCarePlanGuidance(rule, { ...base, treatmentStatusId: "treatment_status_under_treatment" }).products.plans[0]?.duration)
      .toBe("Minimum 3 months during treatment");
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

  test("applies exact exclusions and replacements with the source quantity", () => {
    const rule = definition();
    const pre: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_newly_diagnosed",
      plannedTreatmentStartDate: "2026-10-20" };
    expect(resolveCarePlanGuidance(rule, pre).products.status).toBe("facts_required");
    expect(resolveCarePlanGuidance(rule, { ...pre, cancerTypeId: "cancer_6" }).products).toMatchObject({
      status: "selected", plans: [{ products: "Invigour", dose: "1 Invigour" }],
    });
    expect(resolveCarePlanGuidance(rule, { ...pre, cancerTypeId: "cancer_5" }).products).toMatchObject({
      status: "selected", plans: [{ products: "Invigour + Nourish", dose: "1 Invigour + 1 Nourish" }],
    });
    const surgery: CarePlanFacts = { ...base, surgicalStatusId: "cancer_surgical_status_done", surgeryDate: "2026-10-08" };
    expect(resolveCarePlanGuidance(rule, surgery).products.status).toBe("facts_required");
    expect(resolveCarePlanGuidance(rule, { ...surgery, dietPreferenceId: "vegetarian" }).products).toMatchObject({
      status: "selected", plans: [{ products: "Invigour", dose: "2 Invigour" }],
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
    expect(vegetarian.status).toBe("selected");
    expect(vegetarian.notes.map(row => row.kind)).toEqual(["vegetarian_liss_substitution"]);
    const jain = resolveCarePlanGuidance(rule, { ...surgery, dietPreferenceId: "jain" }).products;
    expect(jain.status).toBe("selected");
    expect(jain.notes.map(row => row.kind)).not.toContain("surgery_done_liss");
    expect(jain.notes.map(row => row.kind)).toEqual(["jain_liss_substitution"]);
    expect(jain.plans[0]).toMatchObject({ products: "Invigour", dose: "2 Invigour" });

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

  test("saved assessment answers and surgery windows control product exceptions", () => {
    const rule = definition();
    const notes = rule.carePlanGuidance!.products.notes;
    const exclusion = notes.find(row => row.kind === "pancreatic_nourish_exclusion")!;
    exclusion.match = { fieldId: "cancer_type", optionId: "cancer_7" };
    const pre: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_newly_diagnosed", plannedTreatmentStartDate: "2026-10-20", cancerTypeId: "cancer_6" };
    expect(resolveCarePlanGuidance(rule, pre).products.status).toBe("selected");
    expect(resolveCarePlanGuidance(rule, { ...pre, cancerTypeId: "cancer_7" }).products).toMatchObject({ status: "selected", plans: [{ products: "Invigour" }] });

    const vegetarian = notes.find(row => row.kind === "vegetarian_liss_substitution")!;
    vegetarian.match = { fieldId: "diet_preference", optionId: "eggetarian" };
    const surgery: CarePlanFacts = { ...base, surgicalStatusId: "cancer_surgical_status_done", surgeryDate: "2026-10-08", dietPreferenceId: "eggetarian" };
    expect(resolveCarePlanGuidance(rule, surgery).products.notes.map(row => row.kind)).toContain("vegetarian_liss_substitution");
    const recent = notes.find(row => row.kind === "surgery_done_liss")!;
    recent.match = { fieldId: "cancer_surgical_status", optionId: "cancer_surgical_status_done", withinDays: 2 };
    expect(resolveCarePlanGuidance(rule, { ...surgery, dietPreferenceId: "non_vegetarian" }).products.notes.map(row => row.kind))
      .not.toContain("surgery_done_liss");
    expect(validateFinalAssessmentDefinition(rule)).toEqual([]);
    notes.find(row => row.kind === "jain_liss_substitution")!.match = { fieldId: "diet_preference", optionId: "eggetarian" };
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("DUPLICATE_PRODUCT_NOTE_MATCH");
  });

  test("additional rules may use an existing product action for a different answer", () => {
    const rule = definition();
    const notes = rule.carePlanGuidance!.products.notes;
    const exclusion = notes.find(row => row.kind === "pancreatic_nourish_exclusion")!;
    notes.push({ ...exclusion, id: "another_nourish_exclusion", label: "Additional cancer exception",
      match: { fieldId: "cancer_type", optionId: "cancer_7" }, guidance: "Exclude Nourish for this cancer type." });
    expect(validateFinalAssessmentDefinition(rule)).toEqual([]);
    const pre: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_newly_diagnosed",
      plannedTreatmentStartDate: "2026-10-20", cancerTypeId: "cancer_7" };
    expect(resolveCarePlanGuidance(rule, pre).products).toMatchObject({
      status: "selected", plans: [{ products: "Invigour" }], notes: [{ id: "another_nourish_exclusion" }],
    });
    expect(resolveCarePlanGuidance(rule, { ...pre, cancerTypeId: "cancer_6" }).products.notes.map(row => row.id))
      .toEqual([exclusion.id]);
  });

  test("custom exact actions change the selected plan and preserve its duration", () => {
    const rule = definition();
    const notes = rule.carePlanGuidance!.products.notes;
    const custom = {
      id: "custom_cancer_product", kind: "custom" as const,
      match: { fieldId: "cancer_type" as const, optionId: "cancer_7" },
      label: "Clinician approved product change", guidance: "", sourceText: "Manual entry", enabled: true,
      source: { document: "Manual entry", location: "Rules editor", note: "" },
      action: { type: "recommend" as const, productName: "Nourish", quantityPerDay: 3 },
    };
    notes.push(custom);
    const facts: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_newly_diagnosed",
      plannedTreatmentStartDate: "2026-10-20", cancerTypeId: "cancer_7" };
    expect(validateFinalAssessmentDefinition(rule)).toEqual([]);
    expect(resolveCarePlanGuidance(rule, facts).products.plans[0]).toMatchObject({
      dose: "1 Invigour + 3 Nourish", duration: "15 days before treatment (2026-10-05 to 2026-10-19, with treatment planned for 2026-10-20)",
    });
    notes.pop();
    notes.push({ ...custom, action: { type: "replace", productName: "Nourish", replacementProductName: "Protect", replacementQuantityPerDay: 2 } });
    expect(resolveCarePlanGuidance(rule, facts).products.plans[0]).toMatchObject({ dose: "1 Invigour + 2 Protect" });
    notes.pop();
    notes.push({ ...custom, action: { type: "replace", productName: "Nourish", replacementProductName: "Protect" } });
    expect(resolveCarePlanGuidance(rule, facts).products).toMatchObject({ status: "clinician_choice_required", plans: [] });
  });

  test("replacement copies the replaced product's daily quantity when selected", () => {
    const rule = definition();
    const plan = rule.carePlanGuidance!.products.plans.find(row => row.stage === "pre_conditioning" && row.nutritionalStatus === "moderately_nourished")!;
    plan.products = "Invigour + Liss WH";
    plan.dose = "1 Invigour + 2 Liss WH";
    plan.productNames = ["Invigour", "Liss WH"];
    const facts: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_newly_diagnosed",
      plannedTreatmentStartDate: "2026-10-20", dietPreferenceId: "vegetarian" };
    expect(resolveCarePlanGuidance(rule, facts).products).toMatchObject({ status: "selected",
      plans: [{ products: "Invigour", items: [{ productName: "Invigour", quantityPerDay: 2 }] }] });
    rule.carePlanGuidance!.products.notes.push({
      id: "eggetarian_remove_liss", kind: "custom", label: "Remove Liss WH for eggetarian diet",
      match: { fieldId: "diet_preference", optionId: "eggetarian" },
      action: { type: "remove", productName: "Liss WH" }, guidance: "", sourceText: "Manual entry",
      enabled: true, source: { document: "Manual entry", location: "Rules editor", note: "" },
    });
    expect(resolveCarePlanGuidance(rule, { ...facts, dietPreferenceId: "eggetarian" }).products).toMatchObject({
      status: "selected", plans: [{ products: "Invigour", dose: "1 Invigour" }],
    });
  });

  test("delay removes a named product until planned surgery and rejects conflicting actions", () => {
    const rule = definition();
    const plan = rule.carePlanGuidance!.products.plans.find(row => row.stage === "pre_conditioning" && row.nutritionalStatus === "moderately_nourished")!;
    plan.products = "Invigour + Liss WH";
    plan.dose = "1 Invigour + 1 Liss WH";
    plan.productNames = ["Invigour", "Liss WH"];
    const facts: CarePlanFacts = { ...base, treatmentStatusId: "treatment_status_newly_diagnosed",
      plannedTreatmentStartDate: "2026-10-20", surgicalStatusId: "cancer_surgical_status_planned",
      plannedSurgeryDate: "2026-10-14", dietPreferenceId: "non_vegetarian" };
    expect(resolveCarePlanGuidance(rule, facts).products).toMatchObject({ status: "selected", plans: [{ products: "Invigour" }] });
    expect(resolveCarePlanGuidance(rule, { ...facts, plannedSurgeryDate: "2026-11-14" }).products.plans[0]?.products).toBe("Invigour + Liss WH");
    const original = rule.carePlanGuidance!.products.notes.find(row => row.kind === "surgery_planned_liss")!;
    rule.carePlanGuidance!.products.notes.push({ ...original, id: "duplicate_delay", kind: "custom", label: "Conflicting Liss change" });
    expect(validateFinalAssessmentDefinition(rule).map(issue => issue.code)).toContain("DUPLICATE_PRODUCT_NOTE_MATCH");
    expect(resolveCarePlanGuidance(rule, facts).products.status).toBe("clinician_choice_required");
  });

  test("Other receives only the existing generic nutrition layer", () => {
    const result = resolveCarePlanGuidance(definition(), { ...base, drugClassIds: ["other"],
      coMorbidityIds: ["co_morbidities_diabetes"], treatmentStatusId: "treatment_status_under_treatment" });
    expect(result).toEqual({ nutritionalStatus: null, statusModifiers: [], treatmentGuidance: [], coMorbidities: [],
      products: { status: "none", plans: [], notes: [] } });
  });
});
