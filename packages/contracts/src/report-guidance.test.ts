import { describe, expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "./final-assessment-template";
import { validateFinalAssessmentDefinition } from "./final-assessment-validation";
import { initialReportGuidance } from "./report-guidance-template";
import { publicQuestionnaire } from "./rule-public";
import { classOnlyToxicity, resolveReportGuidance } from "./report-guidance";

describe("versioned report guidance", () => {
  test("new rule versions include the reviewed toxicity matches", () => {
    const first = createFinalAssessmentTemplate("First draft");
    const second = createFinalAssessmentTemplate("Second draft");
    const rows = first.reportGuidance!.toxicity;
    expect(rows).toHaveLength(136);
    expect(rows.filter(row => row.match?.mode === "assessment_answer")).toHaveLength(46);
    expect(rows.filter(row => row.match?.mode === "weight_change")).toHaveLength(3);
    expect(rows.filter(row => row.match?.mode === "clinician_confirmation")).toHaveLength(87);
    expect(rows.every(row => row.match)).toBe(true);
    expect(rows.find(row => row.id === "toxicity_row_009")?.match).toMatchObject({ mode: "assessment_answer", operator: "any" });
    expect(rows.find(row => row.id === "toxicity_row_080")?.match).toEqual({ mode: "clinician_confirmation" });
    expect(rows.find(row => row.id === "toxicity_row_107")?.match).toEqual({ mode: "weight_change", direction: "gain" });
    const firstAnswer = rows.find(row => row.id === "toxicity_row_009")!.match;
    if (firstAnswer?.mode !== "assessment_answer") throw new Error("expected a patient answer match");
    firstAnswer.anyOf[0]!.optionId = "edited_only_in_first";
    const secondAnswer = second.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_009")?.match;
    expect(secondAnswer?.mode).toBe("assessment_answer");
    if (secondAnswer?.mode !== "assessment_answer") throw new Error("expected a patient answer match");
    expect(secondAnswer.anyOf[0]?.optionId).toBe("dietary_symptoms_fatigue");
  });

  test("new versions retain source provenance and use one class-wide toxicity label", () => {
    const guidance = initialReportGuidance();
    expect(guidance.nutrition.map(row => [row.riskCategoryId, row.source.location])).toEqual([
      ["high", "row 2"], ["moderate", "row 3"], ["low", "row 4"],
    ]);
    expect(guidance.toxicity).toHaveLength(136);
    expect(guidance.toxicity.map(row => row.source.location)).toEqual(Array.from({ length: 136 }, (_, index) => `row ${index + 2}`));
    expect(new Set(guidance.toxicity.map(row => row.classId)).size).toBe(16);
    expect(guidance.nutrition[0]?.clinicalActions).toContain("≥75%");
    expect(guidance.toxicity[0]?.nutritionalInterventions).toContain("→ contact the oncologist");
    expect(guidance.toxicity.find(row => row.id === "toxicity_row_006")?.expectedToxicity).toBe("Diarrhea");
    expect(guidance.toxicity.find(row => row.id === "toxicity_row_007")?.expectedToxicity).toBe("Fluid retention");
    expect(guidance.toxicity.some(row => row.requiresDrugConfirmation || row.classLevelToxicity || row.classLevelInterventions)).toBe(false);
  });

  test("older saved rows still resolve to their class-wide wording", () => {
    const original = initialReportGuidance().toxicity.find(row => row.id === "toxicity_row_006")!;
    const legacy = { ...original, expectedToxicity: "Diarrhea (docetaxel, cabazitaxel)", requiresDrugConfirmation: true,
      classLevelToxicity: "Diarrhea", classLevelInterventions: original.nutritionalInterventions };
    const visible = classOnlyToxicity(legacy);
    expect(visible.expectedToxicity).toBe("Diarrhea");
    expect(visible.requiresDrugConfirmation).toBe(false);
    expect(visible.classLevelToxicity).toBeUndefined();
    const missingAlternative = { ...legacy, classLevelToxicity: undefined, classLevelInterventions: undefined };
    expect(classOnlyToxicity(missingAlternative).expectedToxicity).toBe("Diarrhea");
    expect(classOnlyToxicity({ ...missingAlternative, nutritionalInterventions: "Custom clinical wording" }).requiresDrugConfirmation).toBe(true);
    const definition = createFinalAssessmentTemplate("Older draft");
    definition.reportGuidance!.toxicity = definition.reportGuidance!.toxicity.map(row =>
      row.id === missingAlternative.id ? missingAlternative : row);
    const matched = resolveReportGuidance(definition, {
      riskCategoryId: "low", treatmentTypeIds: ["current_cancer_treatment_chemotherapy"],
      drugClassIds: ["taxanes"], confirmedToxicityIds: [missingAlternative.id],
    });
    expect(matched.toxicity.find(row => row.id === missingAlternative.id)?.expectedToxicity).toBe("Diarrhea");
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
    expect(resolveReportGuidance(definition, { ...facts, confirmedToxicityIds: [] }).possibleToxicities.find(rule => rule.id === "toxicity_row_033")?.nutritionalInterventions).not.toContain("oxaliplatin");
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
