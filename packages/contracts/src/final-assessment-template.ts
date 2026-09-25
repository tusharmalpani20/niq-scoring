import { DEFAULT_FACE_SCAN_SCORING_CONFIG } from "./face-scan-scoring";
import { finalAssessmentDefinitionSchema, type FinalAssessmentDefinition } from "./final-assessment";

const document = "Final NIQ Assessment Form_with section_field_details.xlsx";
const source = (location: string, note = "") => ({ document, location, note });
const fixed = (id: string, label: string, kind: "select" | "multi_select" | "yes_no" | "conditional" | "count" | "calculated" | "derived", options: Array<{ id: string; label: string }>, scoring: Record<string, unknown>, location: string, help = "") => ({ id, label, kind, ...(kind !== "calculated" && kind !== "derived" ? { options } : {}), help, unit: "", scoring, sources: [source(location)], });
const points = (entries: Array<[string, number]>) => entries.map(([optionId, value]) => ({ optionId, points: value }));
const option = (id: string, label: string) => ({ id, label, help: "" });
const multi = (id: string, label: string, entries: Array<[string, string]>, scoring: Record<string, unknown>, location: string) => fixed(id, label, "multi_select", entries.map(([key, label]) => option(`${id}_${key}`, label)), scoring, location);
const select = (id: string, label: string, entries: Array<[string, string]>, scoring: Record<string, unknown>, location: string) => fixed(id, label, "select", entries.map(([key, label]) => option(`${id}_${key}`, label)), scoring, location);
const yesNo = (id: string, label: string, scoring: Record<string, unknown>, location: string) => fixed(id, label, "yes_no", [option(`${id}_yes`, "Yes"), option(`${id}_no`, "No")], scoring, location);

const tumourType = multi("tumour_type", "Type of tumour", [
  ["solid", "Solid Tumour"], ["haematological", "Haematological"], ["metastatic_secondary", "Metastatic / Secondary"], ["in_situ", "In Situ"],
], { kind: "options", aggregation: "sum", points: points([["tumour_type_solid", 2], ["tumour_type_haematological", 1], ["tumour_type_metastatic_secondary", 3], ["tumour_type_in_situ", 1]]) }, "F11:G14");
const stage = select("stage", "Stage", [["localized", "Localized (stage 1–2)"], ["locally_advanced", "Locally Advanced (stage 3)"], ["metastatic", "Metastatic (Stage 4)" ]], { kind: "options", aggregation: "sum", points: points([["stage_localized", 1], ["stage_locally_advanced", 2], ["stage_metastatic", 3]]) }, "F39:G41");
const relapse = select("relapse_status", "Relapse status", [["first_diagnosis", "First Diagnosis"], ["relapsed", "Relapsed"], ["refractory", "Refractory"]], { kind: "options", aggregation: "sum", points: points([["relapse_status_first_diagnosis", 0], ["relapse_status_relapsed", 1], ["relapse_status_refractory", 2]]) }, "F47:G49");

const treatmentStatus = fixed("treatment_status", "Treatment status", "conditional", [
  option("treatment_status_newly_diagnosed", "Newly Diagnosed"), option("treatment_status_under_treatment", "Under Treatment"), option("treatment_status_post_treatment", "Post-Treatment"), option("treatment_status_palliative_care", "Palliative Care"),
], {
  kind: "conditional",
  normalPoints: points([["treatment_status_newly_diagnosed", 0], ["treatment_status_under_treatment", 2], ["treatment_status_post_treatment", 1]]),
  palliative: { optionId: "treatment_status_palliative_care", paths: [
    { id: "with_cancer", label: "With Cancer any stage", points: 3, children: [] },
    { id: "post_treatment", label: "Post treatment", points: 0, children: [
      { id: "within_6_months", label: "Within 6 months", points: 3 }, { id: "within_12_months", label: "Within 12 months", points: 2 }, { id: "post_12_months", label: "Post 12 months", points: 1 },
    ] },
  ] },
}, "F50:G53");
const surgical = select("cancer_surgical_status", "Cancer surgical status", [["done", "Surgery Done"], ["planned", "Planned"], ["not_required", "Not Required"], ["not_fit", "Not Fit for Surgery"]], { kind: "options", aggregation: "sum", points: points([["cancer_surgical_status_done", 1], ["cancer_surgical_status_planned", 2], ["cancer_surgical_status_not_required", 0], ["cancer_surgical_status_not_fit", 3]]) }, "F54:G57");
const cancerTreatment = multi("current_cancer_treatment", "Current cancer treatment", [["chemotherapy", "Chemotherapy (Cytotoxic)"], ["immunotherapy", "Immunotherapy"], ["radiation", "Radiation Therapy"], ["targeted", "Targeted Therapy"], ["hormonal", "Hormonal Therapy"], ["other", "Other treatment"]], { kind: "options", aggregation: "sum", points: points([["current_cancer_treatment_chemotherapy", 3], ["current_cancer_treatment_immunotherapy", 2], ["current_cancer_treatment_radiation", 1], ["current_cancer_treatment_targeted", 1], ["current_cancer_treatment_hormonal", 1], ["current_cancer_treatment_other", 1]]) }, "F58:G63");
const medications = multi("current_medications", "Current medications", [["blood_thinners", "Blood Thinners"], ["anti_hypertensives", "Anti-hypertensives (BP meds)"], ["anti_diabetics", "Anti-diabetics"], ["thyroid", "Thyroid"], ["cholesterols", "Cholesterols"], ["steroids", "Steroids"], ["anti_histamines", "Anti-histamines"], ["pain_medications", "Pain medications"], ["antibiotics", "Antibiotics"], ["antacid", "Antacid"]], { kind: "options", aggregation: "sum", points: points([["current_medications_blood_thinners", 1], ["current_medications_anti_hypertensives", 1], ["current_medications_anti_diabetics", 1], ["current_medications_thyroid", 1], ["current_medications_cholesterols", 1], ["current_medications_steroids", 1], ["current_medications_anti_histamines", 1], ["current_medications_pain_medications", 1], ["current_medications_antibiotics", 1], ["current_medications_antacid", 1]]) }, "F66:G75");
const supplements = multi("supplements_intake", "Supplements intake", [["protein", "Protein supplements"], ["iron", "Iron"], ["calcium", "Calcium"], ["folic_acid", "Folic Acid"], ["multivitamins", "Multivitamins"], ["omega_3", "Omega-3"]], { kind: "options", aggregation: "sum", points: points([["supplements_intake_protein", 1], ["supplements_intake_iron", 1], ["supplements_intake_calcium", 1], ["supplements_intake_folic_acid", 1], ["supplements_intake_multivitamins", 1], ["supplements_intake_omega_3", 1]]) }, "F76:G81");

const coMorbidities = multi("co_morbidities", "Co-morbidities", [["diabetes", "Diabetes"], ["hypertension", "Hypertension"], ["thyroid_disorder", "Thyroid Disorder"], ["kidney_disease", "Kidney Disease"], ["liver_disease", "Liver Disease"], ["cardiac_disease", "Cardiac Disease"], ["high_cholesterol", "High Cholesterol"], ["psychological_disorders", "Psychological Disorders"]], { kind: "options", aggregation: "sum", points: points([["co_morbidities_diabetes", 1], ["co_morbidities_hypertension", 1], ["co_morbidities_thyroid_disorder", 1], ["co_morbidities_kidney_disease", 1], ["co_morbidities_liver_disease", 1], ["co_morbidities_cardiac_disease", 1], ["co_morbidities_high_cholesterol", 1], ["co_morbidities_psychological_disorders", 1]]) }, "F89:G96");
const surgeries = { ...fixed("previous_surgeries", "Previous surgeries", "count", [option("previous_surgeries_yes", "Yes"), option("previous_surgeries_no", "No")], { kind: "count", pointsPerCount: 1 }, "F97:G98", "Number of previous surgeries is multiplied by the configured point rate."), countInputId: "previous_surgery_count" };
const familyHistory = yesNo("family_history_cancer", "Family history of cancer", { kind: "options", aggregation: "sum", points: points([["family_history_cancer_yes", 1], ["family_history_cancer_no", 0]]) }, "F99:G100");

const appetite = select("appetite_status", "Appetite status", [["normal", "Normal"], ["reduced", "Reduced"], ["no_appetite", "No Appetite"]], { kind: "options", aggregation: "sum", points: points([["appetite_status_normal", 0], ["appetite_status_reduced", 2], ["appetite_status_no_appetite", 3]]) }, "F101:G103");
const gastrointestinal = multi("gastrointestinal_symptoms", "Gastrointestinal symptoms", [["bloating", "Bloating"], ["acidity_reflux", "Acidity / Reflux"], ["nausea", "Nausea"], ["vomiting", "Vomiting"], ["early_satiety", "Early Satiety"], ["taste_changes", "Taste Changes (Dysgeusia)"], ["dysphagia", "Dysphagia"], ["pain_while_eating", "Pain while eating"], ["mouth_ulcers", "Mouth Ulcers / Mucositis"]], { kind: "options", aggregation: "sum", points: points([["gastrointestinal_symptoms_bloating", 1], ["gastrointestinal_symptoms_acidity_reflux", 1], ["gastrointestinal_symptoms_nausea", 1], ["gastrointestinal_symptoms_vomiting", 1], ["gastrointestinal_symptoms_early_satiety", 1], ["gastrointestinal_symptoms_taste_changes", 1], ["gastrointestinal_symptoms_dysphagia", 1], ["gastrointestinal_symptoms_pain_while_eating", 1], ["gastrointestinal_symptoms_mouth_ulcers", 1]]) }, "F104:G112");

const weightLoss = { ...fixed("weight_loss", "Weight loss/gain", "calculated", [], { kind: "ranges", bands: [
  { id: "weight_gain_or_no_change", min: null, max: 0, minInclusive: true, maxInclusive: true, points: 0 },
  { id: "weight_loss_below_5", min: 0, max: 5, minInclusive: false, maxInclusive: false, points: 1 },
  { id: "weight_loss_5_to_10", min: 5, max: 10, minInclusive: true, maxInclusive: true, points: 2 },
  { id: "weight_loss_above_10", min: 10, max: null, minInclusive: false, maxInclusive: true, points: 3 },
 ] }, "F120:G125", "Calculated from current weight and weight 1–2 months ago. The unrounded percentage determines the band."), inputIds: ["previous_weight_kg", "current_weight_kg"], formula: "(previousWeightKg - currentWeightKg) / previousWeightKg * 100" };
const dietarySymptoms = multi("dietary_symptoms", "Symptoms", [["no_problem", "No problem while eating"], ["no_appetite", "No appetite, just did not feel like eating"], ["nausea", "Nausea"], ["vomiting", "Vomiting"], ["constipation", "Constipation"], ["diarrhoea", "Diarrhoea"], ["mouth_sores", "Mouth sores"], ["dry_mouth", "Dry mouth"], ["taste_funny", "Things taste funny or have no taste"], ["smells_bother", "Smells bother me"], ["swallowing_problems", "Problems while swallowing"], ["feel_full_quickly", "Feel full quickly"], ["fatigue", "Fatigue"], ["muscle_loss", "Muscle loss"]], { kind: "options", aggregation: "sum", points: points([["dietary_symptoms_no_problem", 0], ["dietary_symptoms_no_appetite", 3], ["dietary_symptoms_nausea", 1], ["dietary_symptoms_vomiting", 3], ["dietary_symptoms_constipation", 1], ["dietary_symptoms_diarrhoea", 3], ["dietary_symptoms_mouth_sores", 2], ["dietary_symptoms_dry_mouth", 1], ["dietary_symptoms_taste_funny", 1], ["dietary_symptoms_smells_bother", 1], ["dietary_symptoms_swallowing_problems", 2], ["dietary_symptoms_feel_full_quickly", 1], ["dietary_symptoms_fatigue", 1], ["dietary_symptoms_muscle_loss", 3]]) }, "F132:G145");
const functional = select("functional_capacity", "Functional capacity", [["normal_activity", "Normal Activity"], ["reduced_activity", "Reduced Activity"], ["bedridden", "Bedridden"]], { kind: "options", aggregation: "sum", points: points([["functional_capacity_normal_activity", 0], ["functional_capacity_reduced_activity", 1], ["functional_capacity_bedridden", 2]]) }, "F146:G148");
const stress = select("stress_level", "Stress level", [["high", "High"], ["moderate", "Moderate"], ["none_low", "None / Low"]], { kind: "options", aggregation: "sum", points: points([["stress_level_high", 2], ["stress_level_moderate", 1], ["stress_level_none_low", 0]]) }, "F149:G151");
const protein = { ...fixed("protein_intake", "Protein intake", "derived", [], { kind: "derived", outcomes: [{ id: "adequate", label: "Adequate", points: 0 }, { id: "inadequate", label: "Inadequate", points: 1 }], mapping: [
  { inputOptionId: "dietary_intake_normal", outcomeId: "adequate" }, { inputOptionId: "dietary_intake_more_than_usual", outcomeId: "adequate" }, { inputOptionId: "dietary_intake_reduced", outcomeId: "inadequate" }, { inputOptionId: "dietary_intake_liquid", outcomeId: "inadequate" }, { inputOptionId: "dietary_intake_little_solid", outcomeId: "inadequate" }, { inputOptionId: "dietary_intake_tube_feeding", outcomeId: "inadequate" },
 ] }, "F126:G131; F152:G153", "Derived from dietary intake. Normal intake and More than usual are Adequate."), sourceInputId: "dietary_intake" };
const fluid = select("fluid_intake", "Fluid intake", [["below_1_litre", "<1 litre"], ["one_to_two_litres", "1–2 litres"], ["above_2_litres", ">2 litres"]], { kind: "options", aggregation: "sum", points: points([["fluid_intake_below_1_litre", 3], ["fluid_intake_one_to_two_litres", 2], ["fluid_intake_above_2_litres", 1]]) }, "F154:G156");

export function createLegacyFinalAssessmentTemplate(name: string): FinalAssessmentDefinition {
  return finalAssessmentDefinitionSchema.parse({
    formatVersion: 2,
    profile: "NIQ_FINAL_ASSESSMENT",
    name,
    description: "Final NIQ assessment scoring profile. Temporary risk thresholds are for internal development only and are not clinically approved.",
    sections: [
      { id: "disease_status", title: "Disease status", description: "Cancer diagnosis scoring inputs.", accent: "orange", fields: [tumourType, stage, relapse] },
      { id: "treatment", title: "Treatment", description: "Treatment and medication scoring inputs.", accent: "green", fields: [treatmentStatus, surgical, cancerTreatment, medications, supplements] },
      { id: "health_history", title: "Health history", description: "Co-morbidity, surgery count and family history scoring inputs.", accent: "grey", fields: [coMorbidities, surgeries, familyHistory] },
      { id: "clinical_gut_health", title: "Clinical & GUT health", description: "Appetite and gastrointestinal symptom scoring inputs.", accent: "purple", fields: [appetite, gastrointestinal] },
      { id: "dietary_details", title: "Dietary details", description: "Weight, symptoms, function, stress, protein and fluids.", accent: "beige", fields: [weightLoss, dietarySymptoms, functional, stress, protein, fluid] },
    ],
    supportingInputs: [
      { id: "palliative_status", label: "Palliative treatment path", kind: "select", required: false, options: [option("with_cancer", "With Cancer any stage"), option("post_treatment", "Post treatment")], sources: [source("F53:G53")] },
      { id: "palliative_timing", label: "Palliative post-treatment timing", kind: "select", required: false, options: [option("within_6_months", "Within 6 months"), option("within_12_months", "Within 12 months"), option("post_12_months", "Post 12 months")], sources: [source("F53:G53")] },
      { id: "previous_surgery_count", label: "Number of previous surgeries", kind: "number", unit: "surgeries", required: false, sources: [source("H97")] },
      { id: "previous_weight_kg", label: "Weight 1–2 months ago", kind: "number", unit: "kg", required: false, sources: [source("F120:H121")] },
      { id: "current_weight_kg", label: "Current weight", kind: "number", unit: "kg", required: false, sources: [source("F120:H121")] },
      { id: "dietary_intake", label: "Dietary intake change", kind: "select", required: false, options: [option("dietary_intake_normal", "Normal Intake"), option("dietary_intake_more_than_usual", "More than usual"), option("dietary_intake_reduced", "Reduced Intake / less than usual"), option("dietary_intake_liquid", "Liquid Diet"), option("dietary_intake_little_solid", "Little solid food"), option("dietary_intake_tube_feeding", "Tube Feeding")], sources: [source("F126:H152")] },
    ],
    riskCategories: [
      { id: "low", label: "Low", color: "green", interpretation: "Temporary development category. Awaiting client confirmation.", min: null, max: 16, minInclusive: true, maxInclusive: false, sources: [source("Development placeholder", "Below 16")] },
      { id: "moderate", label: "Moderate", color: "amber", interpretation: "Temporary development category. Awaiting client confirmation.", min: 16, max: 26, minInclusive: true, maxInclusive: false, sources: [source("Development placeholder", "16 to below 26")] },
      { id: "high", label: "High", color: "red", interpretation: "Temporary development category. Awaiting client confirmation.", min: 26, max: null, minInclusive: true, maxInclusive: true, sources: [source("Development placeholder", "26 and above, unbounded")] },
    ],
    provisional: { status: "DEVELOPMENT_PLACEHOLDER", clinicalUsePermitted: false, notice: "Temporary thresholds — awaiting confirmation. Internal draft evaluation only; blocked from clinical approval and use." },
    interventions: { status: "NOT_APPLICABLE", note: "Interventions are not finalized for the final assessment profile." },
    samples: [],
  });
}

/** Explicitly upgrade a draft; callers must save through revision-checked persistence. */
export function upgradeFinalAssessmentDefinition(input: FinalAssessmentDefinition): FinalAssessmentDefinition {
  const definition = structuredClone(input);
  if (definition.provisional.status === "CLIENT_CONFIRMED") return definition;
  const weight = definition.sections.flatMap(section => section.fields).find(field => field.id === "weight_loss");
  const baselineWeight = createLegacyFinalAssessmentTemplate(input.name).sections.flatMap(section => section.fields).find(field => field.id === "weight_loss");
  if (weight?.kind === "calculated" && baselineWeight?.kind === "calculated") {
    // Stable identifiers preserve integrations; reset thresholds, preserving configured points.
    weight.scoring.bands = baselineWeight.scoring.bands.map(band => ({ ...band, points: weight.scoring.bands.find(current => current.id === band.id)?.points ?? band.points }));
    weight.scoring.bands[1]!.max = 6;
    weight.scoring.bands[2]!.min = 6;
  }
  definition.riskCategories = [
    { id: "low", label: "Low Risk", color: "green", interpretation: "", min: 0, max: 15, minInclusive: true, maxInclusive: true, sources: [] },
    { id: "moderate", label: "Moderate Risk", color: "amber", interpretation: "", min: 16, max: 25, minInclusive: true, maxInclusive: true, sources: [] },
    { id: "high", label: "High Risk", color: "red", interpretation: "", min: 25, max: null, minInclusive: false, maxInclusive: false, sources: [] },
  ];
  definition.provisional = { status: "CLIENT_CONFIRMED", clinicalUsePermitted: true, notice: "Scoring categories confirmed by the client. Normal approval is required before use." };
  if (definition.description === createLegacyFinalAssessmentTemplate(input.name).description) definition.description = "Final NIQ assessment scoring profile.";
  // Invariant package fixtures remain valid when administrators configure points.
  // Independent engine regression tests verify the client-confirmed nonzero defaults.
  definition.samples = confirmedAssessmentSamples();
  return definition;
}

export function confirmedAssessmentSamples(): FinalAssessmentDefinition["samples"] {
  return [
    { id: "unanswered", name: "No answers", answers: {}, expected: { complete: true, score: null, classificationId: null } },
    { id: "no_surgeries", name: "No previous surgeries gives zero points", answers: { previous_surgeries: "previous_surgeries_no" }, expected: { complete: true, score: 0 } },
    { id: "no_selections", name: "Explicitly empty selections give zero points", answers: { current_medications: [], supplements_intake: [] }, expected: { complete: true, score: 0 } },
  ];
}

export function createFinalAssessmentTemplate(name: string): FinalAssessmentDefinition {
  return { ...upgradeFinalAssessmentDefinition(createLegacyFinalAssessmentTemplate(name)), faceScanScoring: { ...DEFAULT_FACE_SCAN_SCORING_CONFIG } };
}
