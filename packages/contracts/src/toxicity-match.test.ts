import { describe, expect, test } from "bun:test";
import { finalAssessmentDefinitionSchema } from "./final-assessment";
import { createFinalAssessmentTemplate } from "./final-assessment-template";
import { validateFinalAssessmentDefinition } from "./final-assessment-validation";
import { matchesToxicityAssessmentAnswers } from "./report-guidance";

function withAnswerMatch() {
  const definition = createFinalAssessmentTemplate("Toxicity match");
  definition.reportGuidance!.toxicity[0]!.match = {
    mode: "assessment_answer",
    anyOf: [
      { fieldId: "gastrointestinal_symptoms", optionId: "gastrointestinal_symptoms_mouth_ulcers" },
      { fieldId: "dietary_symptoms", optionId: "dietary_symptoms_mouth_sores" },
    ],
  };
  return definition;
}

describe("toxicity applicability contract", () => {
  test("accepts OR-matched assessment answers and clinician confirmation", () => {
    const definition = withAnswerMatch();
    definition.reportGuidance!.toxicity[1]!.match = { mode: "clinician_confirmation" };
    expect(finalAssessmentDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(validateFinalAssessmentDefinition(definition)).toEqual([]);
  });

  test("keeps historical rows without a match readable", () => {
    const definition = createFinalAssessmentTemplate("Historical");
    expect(definition.reportGuidance!.toxicity[0]!.match).toBeUndefined();
    expect(finalAssessmentDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  test("rejects empty lists, malformed modes and extra fields", () => {
    const definition = withAnswerMatch();
    const row = definition.reportGuidance!.toxicity[0]!;
    row.match = { mode: "assessment_answer", anyOf: [] };
    expect(finalAssessmentDefinitionSchema.safeParse(definition).success).toBe(false);
    row.match = { mode: "clinician_confirmation", anyOf: [] } as unknown as typeof row.match;
    expect(finalAssessmentDefinitionSchema.safeParse(definition).success).toBe(false);
    row.match = { mode: "free_text" } as unknown as typeof row.match;
    expect(finalAssessmentDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  test("rejects duplicate, missing and wrong-field answer references", () => {
    const definition = withAnswerMatch();
    definition.reportGuidance!.toxicity[0]!.match = {
      mode: "assessment_answer",
      anyOf: [
        { fieldId: "gastrointestinal_symptoms", optionId: "gastrointestinal_symptoms_mouth_ulcers" },
        { fieldId: "gastrointestinal_symptoms", optionId: "gastrointestinal_symptoms_mouth_ulcers" },
        { fieldId: "missing_field", optionId: "dietary_symptoms_mouth_sores" },
        { fieldId: "gastrointestinal_symptoms", optionId: "dietary_symptoms_mouth_sores" },
        { fieldId: "weight_loss", optionId: "weight_loss_above_10" },
      ],
    };
    const issues = validateFinalAssessmentDefinition(definition);
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      "DUPLICATE_MATCH_ANSWER", "UNKNOWN_MATCH_FIELD", "UNKNOWN_MATCH_OPTION", "UNSUPPORTED_MATCH_FIELD",
    ]));
    expect(issues.find(issue => issue.code === "UNKNOWN_MATCH_OPTION")?.path).toBe("reportGuidance.toxicity.0.match.anyOf.3.optionId");
  });

  test("checks references even on disabled rows", () => {
    const definition = withAnswerMatch();
    const row = definition.reportGuidance!.toxicity[0]!;
    row.enabled = false;
    row.match = { mode: "assessment_answer", anyOf: [{ fieldId: "missing_field", optionId: "missing_option" }] };
    expect(validateFinalAssessmentDefinition(definition).map(issue => issue.code)).toContain("UNKNOWN_MATCH_FIELD");
  });

  test("does not let treatment or medication answers confirm a toxicity", () => {
    const definition = withAnswerMatch();
    definition.reportGuidance!.toxicity[0]!.match = {
      mode: "assessment_answer",
      anyOf: [{ fieldId: "current_cancer_treatment", optionId: "current_cancer_treatment_chemotherapy" }],
    };
    expect(validateFinalAssessmentDefinition(definition).map(issue => issue.code)).toContain("UNSUPPORTED_MATCH_FIELD");
  });

  test("allows reduced appetite but rejects normal appetite as symptom evidence", () => {
    const definition = withAnswerMatch();
    const row = definition.reportGuidance!.toxicity[0]!;
    row.match = { mode: "assessment_answer", anyOf: [{ fieldId: "appetite_status", optionId: "appetite_status_reduced" }] };
    expect(validateFinalAssessmentDefinition(definition)).toEqual([]);
    row.match.anyOf[0]!.optionId = "appetite_status_normal";
    expect(validateFinalAssessmentDefinition(definition).map(issue => issue.code)).toContain("NON_SYMPTOM_MATCH_OPTION");
  });

  test("any and all answer choices have distinct behavior; old rows still mean any", () => {
    const match = { mode: "assessment_answer" as const, anyOf: [
      { fieldId: "dietary_symptoms", optionId: "dietary_symptoms_fatigue" },
      { fieldId: "appetite_status", optionId: "appetite_status_reduced" },
    ] };
    const fatigueOnly = { dietary_symptoms: ["dietary_symptoms_fatigue"] };
    expect(matchesToxicityAssessmentAnswers(match, fatigueOnly)).toBe(true);
    expect(matchesToxicityAssessmentAnswers({ ...match, operator: "any" }, fatigueOnly)).toBe(true);
    expect(matchesToxicityAssessmentAnswers({ ...match, operator: "all" }, fatigueOnly)).toBe(false);
    expect(matchesToxicityAssessmentAnswers({ ...match, operator: "all" }, { ...fatigueOnly, appetite_status: "appetite_status_reduced" })).toBe(true);
    expect(matchesToxicityAssessmentAnswers({ mode: "clinician_confirmation" }, fatigueOnly)).toBe(false);
  });

  test("rejects an All match that asks for two values of one single-choice field", () => {
    const definition = withAnswerMatch();
    definition.reportGuidance!.toxicity[0]!.match = { mode: "assessment_answer", operator: "all", anyOf: [
      { fieldId: "appetite_status", optionId: "appetite_status_reduced" },
      { fieldId: "appetite_status", optionId: "appetite_status_no_appetite" },
    ] };
    expect(validateFinalAssessmentDefinition(definition).map(issue => issue.code)).toContain("IMPOSSIBLE_ALL_MATCH");
  });

  test("measured gain requires two positive weights and excludes no change", () => {
    const definition = withAnswerMatch();
    const match = { mode: "weight_change" as const, direction: "gain" as const };
    definition.reportGuidance!.toxicity[0]!.match = match;
    expect(validateFinalAssessmentDefinition(definition)).toEqual([]);
    expect(matchesToxicityAssessmentAnswers(match, { previous_weight_kg: 68, current_weight_kg: 70 })).toBe(true);
    expect(matchesToxicityAssessmentAnswers(match, { previous_weight_kg: 70, current_weight_kg: 70 })).toBe(false);
    expect(matchesToxicityAssessmentAnswers(match, { previous_weight_kg: 70, current_weight_kg: 68 })).toBe(false);
    expect(matchesToxicityAssessmentAnswers(match, { current_weight_kg: 70 })).toBe(false);
    expect(matchesToxicityAssessmentAnswers(match, { previous_weight_kg: 0, current_weight_kg: 70 })).toBe(false);
    expect(matchesToxicityAssessmentAnswers({ ...match, direction: "loss" }, { previous_weight_kg: 70, current_weight_kg: 68 })).toBe(true);
  });
});
