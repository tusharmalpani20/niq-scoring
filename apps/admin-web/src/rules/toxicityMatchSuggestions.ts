import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { classOnlyToxicity } from "@niq-scoring/contracts/report-guidance";
import { initialReportGuidance } from "@niq-scoring/contracts/report-guidance-template";

type Toxicity = NonNullable<FinalAssessmentDefinition["reportGuidance"]>["toxicity"][number];
type Match = NonNullable<Toxicity["match"]>;
type Pair = Extract<Match, { mode: "assessment_answer" }>["anyOf"][number];

// Source sheet row numbers, checked against the imported oncology toxicity rows.
// These proposals match the reported symptom only; they do not establish drug
// causation, severity, or any extra detail in the source row's clinical wording.
const mouthSores = [3, 13, 22, 38, 52, 60, 87, 132];
const tasteChanges = [5, 36, 67];
// Row 080 combines constipation and diarrhea advice; either answer alone
// would expose both plans, so it remains a clinician-confirmation proposal.
const diarrhea = [6, 24, 39, 62, 82, 96, 130];
const constipation = [17, 25];
const nausea = [11, 59, 68, 94, 113];
// The shared advice is suitable for either reported symptom; vomiting-only
// advice is already conditional in the source text ("if vomiting").
const nauseaOrVomiting = [12, 20, 29, 41, 50, 75, 83, 131];
const fatigue = [18, 28, 77, 95, 119];
// These four rows have the same fatigue and reduced-appetite guidance. The
// clinician chose to show it when either symptom is reported.
const fatigueOrReducedAppetite = [9, 86, 103, 133];
// These rows combine compatible nutrition advice. Their source labels are
// references; the report must name only the answer actually observed.
const tasteOrAppetite = [26, 76];
const fatigueOrAppetite = [53, 66];
const explicitAnyRows = new Set([...fatigueOrReducedAppetite, ...nauseaOrVomiting, ...tasteOrAppetite, ...fatigueOrAppetite].map(row => `toxicity_row_${String(row).padStart(3, "0")}`));
const measuredWeightGain = new Set([107, 118, 122].map(row => `toxicity_row_${String(row).padStart(3, "0")}`));

const pair = (fieldId: string, optionId: string): Pair => ({ fieldId, optionId });
const proposals = new Map<string, Pair[]>();
function add(rows: number[], answers: Pair[]) {
  for (const row of rows) {
    const id = `toxicity_row_${String(row).padStart(3, "0")}`;
    proposals.set(id, [...(proposals.get(id) ?? []), ...answers]);
  }
}
add(mouthSores, [
  pair("gastrointestinal_symptoms", "gastrointestinal_symptoms_mouth_ulcers"),
  pair("dietary_symptoms", "dietary_symptoms_mouth_sores"),
]);
add(tasteChanges, [
  pair("gastrointestinal_symptoms", "gastrointestinal_symptoms_taste_changes"),
  pair("dietary_symptoms", "dietary_symptoms_taste_funny"),
]);
add(diarrhea, [pair("dietary_symptoms", "dietary_symptoms_diarrhoea")]);
add(constipation, [pair("dietary_symptoms", "dietary_symptoms_constipation")]);
add(nausea, [
  pair("gastrointestinal_symptoms", "gastrointestinal_symptoms_nausea"),
  pair("dietary_symptoms", "dietary_symptoms_nausea"),
]);
add(nauseaOrVomiting, [
  pair("gastrointestinal_symptoms", "gastrointestinal_symptoms_nausea"),
  pair("gastrointestinal_symptoms", "gastrointestinal_symptoms_vomiting"),
  pair("dietary_symptoms", "dietary_symptoms_nausea"),
  pair("dietary_symptoms", "dietary_symptoms_vomiting"),
]);
add(fatigue, [pair("dietary_symptoms", "dietary_symptoms_fatigue")]);
add(fatigueOrReducedAppetite, [
  pair("dietary_symptoms", "dietary_symptoms_fatigue"),
  pair("appetite_status", "appetite_status_reduced"),
  pair("appetite_status", "appetite_status_no_appetite"),
  pair("dietary_symptoms", "dietary_symptoms_no_appetite"),
]);
const appetiteAnswers = [
  pair("appetite_status", "appetite_status_reduced"),
  pair("appetite_status", "appetite_status_no_appetite"),
  pair("dietary_symptoms", "dietary_symptoms_no_appetite"),
];
add(tasteOrAppetite, [
  pair("gastrointestinal_symptoms", "gastrointestinal_symptoms_taste_changes"),
  pair("dietary_symptoms", "dietary_symptoms_taste_funny"),
  ...appetiteAnswers,
]);
add(fatigueOrAppetite, [pair("dietary_symptoms", "dietary_symptoms_fatigue"), ...appetiteAnswers]);

const sourceRows = new Map(initialReportGuidance().toxicity.map(row => [row.id, row]));

/** Returns a review proposal only while this row still matches its source label and keys. */
export function toxicityMatchSuggestion(definition: FinalAssessmentDefinition, row: Toxicity): Match | undefined {
  const source = sourceRows.get(row.id);
  if (!source || source.classId !== row.classId || source.treatmentTypeId !== row.treatmentTypeId ||
    source.expectedToxicity !== classOnlyToxicity(row).expectedToxicity ||
    source.nutritionalInterventions !== classOnlyToxicity(row).nutritionalInterventions) return undefined;
  if (measuredWeightGain.has(row.id)) return { mode: "weight_change", direction: "gain" };
  const answers = proposals.get(row.id);
  if (!answers) return { mode: "clinician_confirmation" };
  const fields = definition.sections.flatMap(section => section.fields);
  if (answers.some(answer => {
    const field = fields.find(item => item.id === answer.fieldId);
    return !field || !("options" in field) || !field.options.some(option => option.id === answer.optionId);
  })) return undefined;
  return { mode: "assessment_answer", anyOf: answers.map(answer => ({ ...answer })), ...(explicitAnyRows.has(row.id) ? { operator: "any" } : {}) };
}
