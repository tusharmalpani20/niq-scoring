import { describe, expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "./final-assessment-template";
import { validateFinalAssessmentDefinition } from "./final-assessment-validation";
import { initialReportGuidance } from "./report-guidance-template";
import { publicQuestionnaire } from "./rule-public";
import { resolveReportGuidance } from "./report-guidance";

describe("versioned report guidance", () => {
  test("new versions retain every CSV row with stable provenance and repaired symbols", () => {
    const guidance = initialReportGuidance();
    expect(guidance.nutrition.map(row => [row.riskCategoryId, row.source.location])).toEqual([
      ["high", "row 2"], ["moderate", "row 3"], ["low", "row 4"],
    ]);
    expect(guidance.toxicity).toHaveLength(136);
    expect(guidance.toxicity.map(row => row.source.location)).toEqual(Array.from({ length: 136 }, (_, index) => `row ${index + 2}`));
    expect(new Set(guidance.toxicity.map(row => row.classId)).size).toBe(16);
    expect(guidance.nutrition[0]?.clinicalActions).toContain("≥75%");
    expect(guidance.toxicity[0]?.nutritionalInterventions).toContain("→ contact the oncologist");
    expect(guidance.toxicity.find(row => row.id === "toxicity_row_033")?.requiresDrugConfirmation).toBe(true);
    expect(guidance.toxicity.find(row => row.id === "toxicity_row_097")?.requiresDrugConfirmation).toBe(false);
  });

  test("defaults are independent and private guidance is absent from the questionnaire", () => {
    const first = createFinalAssessmentTemplate("A");
    const second = createFinalAssessmentTemplate("B");
    first.reportGuidance!.nutrition[0]!.coreStrategy = "Edited in A";
    expect(second.reportGuidance?.nutrition[0]?.coreStrategy).not.toBe("Edited in A");
    expect(JSON.stringify(publicQuestionnaire(second))).not.toContain("clinicalActions");
    expect(JSON.stringify(publicQuestionnaire(second))).not.toContain("Nutritional interventions");
    expect(validateFinalAssessmentDefinition(second)).toEqual([]);
  });

  test("broken guidance references and duplicate active rows are rejected", () => {
    const definition = createFinalAssessmentTemplate("A");
    definition.reportGuidance!.nutrition[0]!.riskCategoryId = "missing";
    definition.reportGuidance!.toxicity[0]!.classId = "missing";
    definition.reportGuidance!.toxicity[1]!.id = definition.reportGuidance!.toxicity[0]!.id;
    const codes = validateFinalAssessmentDefinition(definition).map(issue => issue.code);
    expect(codes).toContain("UNKNOWN_RISK_CATEGORY");
    expect(codes).toContain("UNKNOWN_DRUG_CLASS");
    expect(codes).toContain("DUPLICATE_GUIDANCE_ID");
  });

  test("only observed class toxicities match; named-drug rows require separate confirmation", () => {
    const definition = createFinalAssessmentTemplate("A");
    const facts = {
      riskCategoryId: "high", treatmentTypeIds: ["current_cancer_treatment_chemotherapy"],
      drugClassIds: ["platinum_agents"], confirmedToxicityIds: ["toxicity_row_030", "toxicity_row_032", "toxicity_row_033"],
      confirmedDrugSpecificRuleIds: [] as string[],
    };
    expect(resolveReportGuidance(definition, facts).nutrition.map(rule => rule.id)).toEqual(["nutrition_high"]);
    expect(resolveReportGuidance(definition, facts).toxicity.map(rule => rule.id)).toEqual(["toxicity_row_030"]);
    expect(resolveReportGuidance(definition, { ...facts, confirmedToxicityIds: [] }).possibleToxicities.map(rule => rule.id)).toContain("toxicity_row_030");
    expect(resolveReportGuidance(definition, facts).possibleToxicities.map(rule => rule.id)).not.toContain("toxicity_row_033");
    expect(resolveReportGuidance(definition, { ...facts, confirmedDrugSpecificRuleIds: ["toxicity_row_032", "toxicity_row_033"] }).toxicity.map(rule => rule.id)).toEqual(["toxicity_row_030", "toxicity_row_032", "toxicity_row_033"]);
    expect(resolveReportGuidance(definition, { ...facts, drugClassIds: ["other", "platinum_agents"], confirmedDrugSpecificRuleIds: facts.confirmedToxicityIds }).possibleToxicities).toEqual([]);
    expect(resolveReportGuidance(definition, { ...facts, confirmedToxicityIds: [] }).toxicity).toEqual([]);
  });
});
