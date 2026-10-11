import { describe, expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "./final-assessment-template";
import { validateFinalAssessmentDefinition } from "./final-assessment-validation";
import { initialReportGuidance, workbookGuidanceImportIssues } from "./report-guidance-template";
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
    expect(guidance.toxicity.filter(row => row.requiresDrugConfirmation)).toHaveLength(40);
    expect(guidance.toxicity.filter(row => row.requiresDrugConfirmation).every(row => row.classLevelToxicity && row.classLevelInterventions)).toBe(true);
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

  test("workbook import explains incompatible older rule drafts before changing them", () => {
    const definition = createFinalAssessmentTemplate("A");
    expect(workbookGuidanceImportIssues(definition)).toEqual([]);
    definition.drugClassConfig!.classes = definition.drugClassConfig!.classes.filter(item => item.id !== "taxanes");
    definition.riskCategories = definition.riskCategories.filter(item => item.id !== "high");
    expect(workbookGuidanceImportIssues(definition)).toEqual(expect.arrayContaining([
      expect.stringContaining("Taxanes"), expect.stringContaining("High Risk"),
    ]));
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

  test("only confirmed toxicities enter guidance, and class-only reports exclude drug-specific wording", () => {
    const definition = createFinalAssessmentTemplate("A");
    const facts = {
      riskCategoryId: "high", treatmentTypeIds: ["current_cancer_treatment_chemotherapy"],
      drugClassIds: ["platinum_agents"], confirmedToxicityIds: ["toxicity_row_030", "toxicity_row_032", "toxicity_row_033"],
    };
    expect(resolveReportGuidance(definition, facts).nutrition.map(rule => rule.id)).toEqual(["nutrition_high"]);
    expect(resolveReportGuidance(definition, facts).toxicity.map(rule => rule.id)).toEqual(["toxicity_row_030", "toxicity_row_032", "toxicity_row_033"]);
    expect(resolveReportGuidance(definition, facts).toxicity.find(rule => rule.id === "toxicity_row_033")?.nutritionalInterventions).not.toContain("oxaliplatin");
    expect(resolveReportGuidance(definition, facts).toxicity.find(rule => rule.id === "toxicity_row_032")?.expectedToxicity).toBe("Nephrotoxicity");
    expect(resolveReportGuidance(definition, { ...facts, confirmedToxicityIds: [] }).possibleToxicities.map(rule => rule.id)).toContain("toxicity_row_030");
    expect(JSON.stringify(resolveReportGuidance(definition, { ...facts, confirmedToxicityIds: [] }).possibleToxicities)).not.toContain("nutritionalInterventions");
    expect(resolveReportGuidance(definition, facts).possibleToxicities.map(rule => rule.id)).toContain("toxicity_row_033");
    expect(resolveReportGuidance(definition, { ...facts, drugClassIds: ["other", "platinum_agents"] }).possibleToxicities).toEqual([]);
    expect(resolveReportGuidance(definition, { ...facts, confirmedToxicityIds: [] }).toxicity).toEqual([]);
    const qt = resolveReportGuidance(definition, { ...facts, treatmentTypeIds: ["current_cancer_treatment_targeted"],
      drugClassIds: ["tyrosine_kinase_inhibitors"], confirmedToxicityIds: ["toxicity_row_074"] });
    expect(qt.toxicity[0]?.expectedToxicity).toBe("QT prolongation");
    expect(qt.toxicity[0]?.nutritionalInterventions).not.toContain("see notes");
  });

  test("selected class-wide guidance reaches the report packet without leaking Other guidance", () => {
    const definition = createFinalAssessmentTemplate("A");
    definition.drugClassConfig!.classes.find(item => item.id === "taxanes")!.guidance = "Use the class protocol.";
    definition.drugClassConfig!.classes.find(item => item.id === "other")!.guidance = "Should not appear.";
    const facts = { riskCategoryId: "low", treatmentTypeIds: ["current_cancer_treatment_chemotherapy"],
      drugClassIds: ["taxanes"], confirmedToxicityIds: [] };
    expect(resolveReportGuidance(definition, facts).classGuidance).toEqual([{ id: "taxanes", label: "Taxanes", guidance: "Use the class protocol." }]);
    expect(resolveReportGuidance(definition, { ...facts, drugClassIds: ["other"] }).classGuidance).toEqual([]);
  });
});
