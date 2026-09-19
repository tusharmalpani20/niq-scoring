import { describe, expect, test } from "bun:test";
import { createLegacyFinalAssessmentTemplate as createFinalAssessmentTemplate, createFinalAssessmentTemplate as confirmedTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { evaluateFinalAssessment, validateFinalAssessmentSamples } from "./final-assessment-evaluator";

const definition = () => createFinalAssessmentTemplate("Assessment v2");

describe("final assessment evaluator", () => {
  test("keeps unanswered distinct from explicit zero answers and supports partial scoring", () => {
    const unanswered = evaluateFinalAssessment(definition(), {});
    expect(unanswered).toMatchObject({ complete: false, score: null, classification: null, answerCoverage: { allUnanswered: true, answeredEntries: 0 } });
    const zero = evaluateFinalAssessment(definition(), { relapse_status: "relapse_status_first_diagnosis" });
    expect(zero).toMatchObject({ complete: true, score: 0, answerCoverage: { answeredEntries: 1, unansweredEntries: 16, pendingEntries: 2 } });
    const emptyMulti = evaluateFinalAssessment(definition(), { gastrointestinal_symptoms: [] });
    expect(emptyMulti).toMatchObject({ complete: true, score: 0, answerCoverage: { answeredEntries: 1 } });
  });

  test("sums every selected option without a GI or overall cap", () => {
    const result = evaluateFinalAssessment(definition(), {
      gastrointestinal_symptoms: [
        "gastrointestinal_symptoms_bloating", "gastrointestinal_symptoms_acidity_reflux", "gastrointestinal_symptoms_nausea", "gastrointestinal_symptoms_vomiting", "gastrointestinal_symptoms_early_satiety", "gastrointestinal_symptoms_taste_changes", "gastrointestinal_symptoms_dysphagia", "gastrointestinal_symptoms_pain_while_eating", "gastrointestinal_symptoms_mouth_ulcers",
      ],
      current_medications: [
        "current_medications_blood_thinners", "current_medications_anti_hypertensives", "current_medications_anti_diabetics", "current_medications_thyroid", "current_medications_cholesterols", "current_medications_steroids", "current_medications_anti_histamines", "current_medications_pain_medications", "current_medications_antibiotics", "current_medications_antacid",
      ],
      supplements_intake: ["supplements_intake_protein", "supplements_intake_iron", "supplements_intake_calcium", "supplements_intake_folic_acid", "supplements_intake_multivitamins", "supplements_intake_omega_3"],
      co_morbidities: ["co_morbidities_diabetes", "co_morbidities_hypertension", "co_morbidities_thyroid_disorder", "co_morbidities_kidney_disease", "co_morbidities_liver_disease", "co_morbidities_cardiac_disease", "co_morbidities_high_cholesterol", "co_morbidities_psychological_disorders"],
      previous_surgeries: "previous_surgeries_yes", previous_surgery_count: 10,
    });
    expect(result.complete).toBe(true);
    expect(result.score).toBe(43);
    expect(result.components.find(component => component.id === "gastrointestinal_symptoms")?.points).toBe(9);
    expect(result.components.find(component => component.id === "previous_surgeries")?.points).toBe(10);
  });

  test("handles palliative branches and rejects inactive children", () => {
    const withCancer = evaluateFinalAssessment(definition(), { treatment_status: "treatment_status_palliative_care", palliative_status: "with_cancer" });
    expect(withCancer.components.find(component => component.id === "treatment_status")?.points).toBe(3);
    const postTreatment = evaluateFinalAssessment(definition(), { treatment_status: "treatment_status_palliative_care", palliative_status: "post_treatment", palliative_timing: "within_12_months" });
    expect(postTreatment.components.find(component => component.id === "treatment_status")?.points).toBe(2);
    const missingLeaf = evaluateFinalAssessment(definition(), { treatment_status: "treatment_status_palliative_care" });
    expect(missingLeaf).toMatchObject({ complete: false, score: null });
    expect(missingLeaf.components.find(component => component.id === "treatment_status")?.status).toBe("pending");
    const inactive = evaluateFinalAssessment(definition(), { treatment_status: "treatment_status_newly_diagnosed", palliative_status: "with_cancer" });
    expect(inactive.issues.some(issue => issue.code === "INACTIVE_DEPENDENCY")).toBe(true);
    expect(inactive.score).toBeNull();
  });

  test("uses linear surgery counts and validates count boundaries", () => {
    const no = evaluateFinalAssessment(definition(), { previous_surgeries: "previous_surgeries_no" });
    expect(no.components.find(component => component.id === "previous_surgeries")?.points).toBe(0);
    const yes = evaluateFinalAssessment(definition(), { previous_surgeries: "previous_surgeries_yes", previous_surgery_count: 4 });
    expect(yes.components.find(component => component.id === "previous_surgeries")?.points).toBe(4);
    expect(evaluateFinalAssessment(definition(), { previous_surgeries: "previous_surgeries_yes" }).components.find(component => component.id === "previous_surgeries")?.status).toBe("pending");
    expect(evaluateFinalAssessment(definition(), { previous_surgeries: "previous_surgeries_yes", previous_surgery_count: 0 }).issues.map(issue => issue.code)).toContain("INVALID_COUNT");
    expect(evaluateFinalAssessment(definition(), { previous_surgeries: "previous_surgeries_yes", previous_surgery_count: 1.5 }).issues.map(issue => issue.code)).toContain("INVALID_COUNT");
  });

  test("compares unrounded weight-loss percentages at every boundary", () => {
    const score = (currentWeight: number) => evaluateFinalAssessment(definition(), { previous_weight_kg: 100, current_weight_kg: currentWeight });
    expect(score(105).components.find(component => component.id === "weight_loss")?.points).toBe(0);
    expect(score(100).components.find(component => component.id === "weight_loss")?.points).toBe(0);
    expect(score(95.001).components.find(component => component.id === "weight_loss")?.points).toBe(1);
    expect(score(95).components.find(component => component.id === "weight_loss")?.points).toBe(2);
    expect(score(90).components.find(component => component.id === "weight_loss")?.points).toBe(2);
    expect(score(89.999).components.find(component => component.id === "weight_loss")?.points).toBe(3);
    expect(score(0).issues.map(issue => issue.code)).toContain("INVALID_WEIGHT");
    expect(evaluateFinalAssessment(definition(), { previous_weight_kg: 100 }).components.find(component => component.id === "weight_loss")?.status).toBe("pending");
  });

  test("maps all dietary intake choices and rejects derived overrides", () => {
    const cases = [
      ["dietary_intake_normal", "adequate", 0], ["dietary_intake_more_than_usual", "adequate", 0], ["dietary_intake_reduced", "inadequate", 1], ["dietary_intake_liquid", "inadequate", 1], ["dietary_intake_little_solid", "inadequate", 1], ["dietary_intake_tube_feeding", "inadequate", 1],
    ] as const;
    for (const [intake, adequacy, points] of cases) {
      const result = evaluateFinalAssessment(definition(), { dietary_intake: intake });
      expect(result.derived.proteinAdequacy).toBe(adequacy);
      expect(result.components.find(component => component.id === "protein_intake")?.points).toBe(points);
    }
    const missing = evaluateFinalAssessment(definition(), {});
    expect(missing.components.find(component => component.id === "protein_intake")?.status).toBe("pending");
    const override = evaluateFinalAssessment(definition(), { dietary_intake: "dietary_intake_normal", protein_intake: "adequate" });
    expect(override.issues.map(issue => issue.code)).toContain("DERIVED_ANSWER_NOT_ALLOWED");
  });

  test("rejects duplicate selections, identity fields and contradictory dietary symptoms", () => {
    const duplicate = evaluateFinalAssessment(definition(), { gastrointestinal_symptoms: ["gastrointestinal_symptoms_nausea", "gastrointestinal_symptoms_nausea"] });
    expect(duplicate.issues.map(issue => issue.code)).toContain("INVALID_ANSWER");
    const identity = evaluateFinalAssessment(definition(), { patient_name: "synthetic" });
    expect(identity.issues.map(issue => issue.code)).toContain("IDENTITY_FIELD_NOT_ALLOWED");
    const contradiction = evaluateFinalAssessment(definition(), { dietary_symptoms: ["dietary_symptoms_no_problem", "dietary_symptoms_nausea"] });
    expect(contradiction.issues.map(issue => issue.code)).toContain("CONTRADICTORY_ANSWER");
  });
});


describe("client-confirmed assessment", () => {
  test("uses six percent and exact ten percent boundaries", () => {
    for (const [current, expected] of [[94.001, 1], [94, 2], [90, 2], [89.999, 3], [100, 0], [101, 0]]) {
      expect(evaluateFinalAssessment(confirmedTemplate("Confirmed"), { previous_weight_kg: 100, current_weight_kg: current }).score).toBe(expected!);
    }
  });
  test("uses configured palliative points", () => {
    const definition = confirmedTemplate("Confirmed");
    const treatment = definition.sections[1]!.fields[0]!;
    if (treatment.kind !== "conditional") throw new Error("treatment");
    treatment.scoring.palliative.paths[0]!.points = 5;
    expect(evaluateFinalAssessment(definition, { treatment_status: "treatment_status_palliative_care", palliative_status: "with_cancer" }).score).toBe(5);
  });
  test("rejects each nonpositive supplied weight even without its counterpart", () => {
    for (const id of ["previous_weight_kg", "current_weight_kg"]) for (const weight of [0, -10]) {
      const result = evaluateFinalAssessment(confirmedTemplate("Confirmed"), { [id]: weight, stage: "stage_localized" });
      expect(result.complete).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({ path: `answers.${id}`, code: "INVALID_WEIGHT" }));
    }
  });
  test("classifies confirmed integer totals and passes independently worked samples", () => {
    const definition = confirmedTemplate("Confirmed");
    expect(validateFinalAssessmentSamples(definition)).toEqual([]);
    for (const [count, label] of [[15, "Low Risk"], [16, "Moderate Risk"], [25, "Moderate Risk"], [26, "High Risk"]] as const) {
      expect(evaluateFinalAssessment(definition, { previous_surgeries: "previous_surgeries_yes", previous_surgery_count: count }).classification?.label).toBe(label);
    }
  });
});
