import { describe, expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { validateFinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment-validation";
import { toxicityMatchSuggestion } from "../src/rules/toxicityMatchSuggestions";

describe("toxicity match review proposals", () => {
  test("covers each source row without assuming that clinical wording is a patient answer", () => {
    const definition = createFinalAssessmentTemplate("Review proposals");
    const rows = definition.reportGuidance!.toxicity;
    const proposed = rows.map(row => toxicityMatchSuggestion(definition, row));
    expect(rows).toHaveLength(136);
    expect(proposed.filter(match => match?.mode === "assessment_answer")).toHaveLength(46);
    expect(proposed.filter(match => match?.mode === "weight_change")).toHaveLength(3);
    expect(proposed.filter(match => match?.mode === "clinician_confirmation")).toHaveLength(87);
    expect(proposed.every(Boolean)).toBe(true);
    definition.reportGuidance!.toxicity = rows.map((row, index) => ({ ...row, match: proposed[index] }));
    expect(validateFinalAssessmentDefinition(definition)).toEqual([]);
  });

  test("does not propose a stale match after a source row has been changed", () => {
    const definition = createFinalAssessmentTemplate("Changed row");
    const row = definition.reportGuidance!.toxicity[1]!;
    row.expectedToxicity = "Edited toxicity";
    expect(toxicityMatchSuggestion(definition, row)).toBeUndefined();
    const other = definition.reportGuidance!.toxicity[2]!;
    other.nutritionalInterventions = "Edited guidance";
    expect(toxicityMatchSuggestion(definition, other)).toBeUndefined();
  });

  test("recognizes an unchanged older draft row without duplicate report fields", () => {
    const definition = createFinalAssessmentTemplate("Older draft");
    const row = definition.reportGuidance!.toxicity.find(item => item.id === "toxicity_row_006")!;
    row.expectedToxicity = "Diarrhea (docetaxel, cabazitaxel)";
    row.requiresDrugConfirmation = true;
    expect(toxicityMatchSuggestion(definition, row)).toEqual({
      mode: "assessment_answer", anyOf: [{ fieldId: "dietary_symptoms", optionId: "dietary_symptoms_diarrhoea" }],
    });
  });

  test("keeps combined constipation or diarrhea advice for clinician review", () => {
    const definition = createFinalAssessmentTemplate("Combined advice");
    const row = definition.reportGuidance!.toxicity.find(item => item.id === "toxicity_row_080")!;
    expect(toxicityMatchSuggestion(definition, row)).toEqual({ mode: "clinician_confirmation" });
  });

  test("matches fatigue or appetite for the four matching combined rows", () => {
    const definition = createFinalAssessmentTemplate("Combined fatigue and appetite");
    for (const id of ["toxicity_row_009", "toxicity_row_086", "toxicity_row_103", "toxicity_row_133"]) {
      const row = definition.reportGuidance!.toxicity.find(item => item.id === id)!;
      const match = toxicityMatchSuggestion(definition, row);
      expect(match?.mode).toBe("assessment_answer");
      if (match?.mode === "assessment_answer") {
        expect(match.anyOf).toContainEqual({ fieldId: "dietary_symptoms", optionId: "dietary_symptoms_fatigue" });
        expect(match.anyOf).toContainEqual({ fieldId: "appetite_status", optionId: "appetite_status_reduced" });
      }
    }
  });

  test("proposes either nausea or vomiting for shared advice, without needing both", () => {
    const definition = createFinalAssessmentTemplate("Nausea or vomiting");
    for (const number of [12, 20, 29, 41, 50, 75, 83, 131]) {
      const row = definition.reportGuidance!.toxicity.find(item => item.id === `toxicity_row_${String(number).padStart(3, "0")}`)!;
      const match = toxicityMatchSuggestion(definition, row);
      expect(match?.mode).toBe("assessment_answer");
      if (match?.mode === "assessment_answer") {
        expect(match.operator).toBe("any");
        expect(match.anyOf).toContainEqual({ fieldId: "gastrointestinal_symptoms", optionId: "gastrointestinal_symptoms_vomiting" });
        expect(match.anyOf).toContainEqual({ fieldId: "dietary_symptoms", optionId: "dietary_symptoms_nausea" });
      }
    }
  });

  test("uses actual measured gain for the three plain weight-gain rows", () => {
    const definition = createFinalAssessmentTemplate("Measured gain");
    for (const number of [107, 118, 122]) {
      const row = definition.reportGuidance!.toxicity.find(item => item.id === `toxicity_row_${number}`)!;
      expect(toxicityMatchSuggestion(definition, row)).toEqual({ mode: "weight_change", direction: "gain" });
    }
    const compositionRow = definition.reportGuidance!.toxicity.find(item => item.id === "toxicity_row_121")!;
    expect(toxicityMatchSuggestion(definition, compositionRow)).toEqual({ mode: "clinician_confirmation" });
  });
});
