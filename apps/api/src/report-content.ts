import { z } from "zod";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { classOnlyToxicity, resolveReportGuidance } from "@niq-scoring/contracts/report-guidance";
import { resolveCarePlanGuidance } from "@niq-scoring/contracts/care-plan-resolver";
import { cancerTypeIds } from "@niq-scoring/contracts/cancer-type-ids";

const id = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const ids = z.array(id).max(500);
const observationLabels = {
  current_weight_kg: ["Current weight", "kg"], height_cm: ["Height", "cm"], bmi: ["BMI", "kg/m²"],
  weight_loss_percent: ["Weight change", "%"], wellness_score: ["Wellness score", "/100"],
  health_risk_score: ["Health risk score", "/100"], heart_rate: ["Heart rate", "bpm"],
  oxygen_saturation: ["Oxygen saturation", "%"], respiratory_rate: ["Respiratory rate", "breaths/min"],
  systolic: ["Systolic blood pressure", "mmHg"], diastolic: ["Diastolic blood pressure", "mmHg"],
  stress_index: ["Stress index", ""],
} as const;
const observationId = z.enum(Object.keys(observationLabels) as [keyof typeof observationLabels, ...(keyof typeof observationLabels)[]]);
const reference = z.string().trim().min(1).max(128);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
});

export const reportContentRequestSchema = z.object({
  assessmentReference: reference,
  resultReference: reference,
  idempotencyKey: z.string().trim().min(8).max(128),
  facts: z.object({
    reviewedScore: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
    reviewedRiskCategoryId: id.optional(),
    treatmentTypeIds: ids,
    drugClassIds: ids,
    confirmedToxicityIds: ids,
    coMorbidityIds: ids.optional(),
    cancerTypeId: id.optional(),
    dietPreferenceId: z.enum(["vegetarian", "non_vegetarian", "eggetarian", "jain"]).optional(),
    treatmentStatusId: id.optional(),
    surgicalStatusId: id.optional(),
    surgeryDate: calendarDate.optional(),
    plannedSurgeryDate: calendarDate.optional(),
    plannedTreatmentStartDate: calendarDate.optional(),
    productStageChoice: z.enum(["surgical", "treatment_stage"]).optional(),
    observations: z.array(z.object({
      id: observationId,
      // Compatibility with Application DTO; neither caller field enters the model.
      label: z.string().trim().max(100).optional(),
      value: z.string().trim().regex(/^-?\d{1,3}(?:\.\d{1,2})?$/),
      unit: z.string().trim().max(30).optional(),
      measuredAt: calendarDate.optional(),
    }).strict()).max(30).default([]),
  }).strict(),
}).strict();
export type ReportContentRequest = z.infer<typeof reportContentRequestSchema>;

const narrativePart = z.object({ text: z.string().trim().min(1).max(1200), evidenceIds: z.array(z.string().min(1).max(120)).min(1).max(20) }).strict();
export const narrativeSchema = z.object({
  overview: narrativePart,
  keyFindings: narrativePart,
  actionSummary: narrativePart,
  monitoringSummary: narrativePart,
}).strict();
export type ReportNarrative = z.infer<typeof narrativeSchema>;
export const reviewSchema = z.object({
  accepted: z.boolean(),
  issues: z.array(z.object({ field: z.enum(["overview", "keyFindings", "actionSummary", "monitoringSummary"]), code: z.enum(["UNSUPPORTED_CLAIM", "UNSUPPORTED_NUMBER", "OVERSTATED_TOXICITY", "DRUG_SPECIFIC_CLAIM", "UNSAFE_INSTRUCTION", "UNCLEAR_WORDING"]), evidenceIds: z.array(z.string()).max(10) }).strict()).max(10),
}).strict();

const narrativeJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["overview", "keyFindings", "actionSummary", "monitoringSummary"],
  properties: Object.fromEntries(["overview", "keyFindings", "actionSummary", "monitoringSummary"].map(key => [key, { type: "object", additionalProperties: false, required: ["text", "evidenceIds"], properties: { text: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } } }])),
};
export const writerJsonSchema = narrativeJsonSchema;
export const reviewerJsonSchema = {
  type: "object", additionalProperties: false, required: ["accepted", "issues"],
  properties: { accepted: { type: "boolean" }, issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "code", "evidenceIds"], properties: { field: { type: "string", enum: ["overview", "keyFindings", "actionSummary", "monitoringSummary"] }, code: { type: "string", enum: ["UNSUPPORTED_CLAIM", "UNSUPPORTED_NUMBER", "OVERSTATED_TOXICITY", "DRUG_SPECIFIC_CLAIM", "UNSAFE_INSTRUCTION", "UNCLEAR_WORDING"] }, evidenceIds: { type: "array", items: { type: "string" } } } } } },
};

export function validateReportFacts(definition: FinalAssessmentDefinition, facts: ReportContentRequest["facts"]): boolean {
  const optionSet = (fieldId: string) => new Set(definition.sections.flatMap(section => section.fields)
    .filter(field => field.id === fieldId && "options" in field)
    .flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
  const classes = new Set(definition.drugClassConfig?.classes.map(item => item.id) ?? []);
  return !(
    facts.drugClassIds.some(value => value !== "other" && !classes.has(value)) ||
    facts.drugClassIds.includes("other") && facts.drugClassIds.length > 1 ||
    facts.treatmentTypeIds.some(value => !optionSet("current_cancer_treatment").has(value)) ||
    facts.coMorbidityIds?.some(value => !optionSet("co_morbidities").has(value)) ||
    facts.treatmentStatusId && !optionSet("treatment_status").has(facts.treatmentStatusId) ||
    facts.surgicalStatusId && !optionSet("cancer_surgical_status").has(facts.surgicalStatusId) ||
    facts.cancerTypeId && !cancerTypeIds.includes(facts.cancerTypeId as typeof cancerTypeIds[number]) ||
    facts.surgeryDate && facts.surgicalStatusId !== "cancer_surgical_status_done" ||
    facts.plannedSurgeryDate && facts.surgicalStatusId !== "cancer_surgical_status_planned" ||
    facts.drugClassIds.includes("other") && facts.confirmedToxicityIds.length > 0 ||
    facts.confirmedToxicityIds.some(confirmedId => !definition.reportGuidance?.toxicity.some(row => row.id === confirmedId && row.enabled
      && facts.drugClassIds.includes(row.classId) && facts.treatmentTypeIds.includes(row.treatmentTypeId)
      && !classOnlyToxicity(row).requiresDrugConfirmation)) ||
    new Set(facts.observations.map(row => row.id)).size !== facts.observations.length
  );
}

export function matchedReportPacket(definition: FinalAssessmentDefinition, facts: ReportContentRequest["facts"], riskCategoryId: string, asOfDate: string) {
  const report = resolveReportGuidance(definition, { riskCategoryId, treatmentTypeIds: facts.treatmentTypeIds, drugClassIds: facts.drugClassIds, confirmedToxicityIds: facts.confirmedToxicityIds });
  const care = resolveCarePlanGuidance(definition, { riskCategoryId, treatmentTypeIds: facts.treatmentTypeIds, drugClassIds: facts.drugClassIds, coMorbidityIds: facts.coMorbidityIds ?? [], cancerTypeId: facts.cancerTypeId ?? null, dietPreferenceId: facts.dietPreferenceId ?? null, treatmentStatusId: facts.treatmentStatusId ?? null, surgicalStatusId: facts.surgicalStatusId ?? null, surgeryDate: facts.surgeryDate ?? null, plannedSurgeryDate: facts.plannedSurgeryDate ?? null, plannedTreatmentStartDate: facts.plannedTreatmentStartDate ?? null, productStageChoice: facts.productStageChoice ?? null, asOfDate });
  return {
    nutritionInterventions: report.nutrition.map(({ id, label, coreStrategy, clinicalActions }) => ({ id, label, coreStrategy, clinicalActions })),
    toxicityInterventions: report.toxicity.map(({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions }) => ({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions })),
    possibleToxicities: report.possibleToxicities.map(({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions }) => ({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions })),
    classGuidance: report.classGuidance,
    carePlan: {
      nutritionalStatus: care.nutritionalStatus,
      statusModifiers: care.statusModifiers.map(({ id, classId, treatmentTypeId, nutritionalStatus, riskEmphasis, actions }) => ({ id, classId, treatmentTypeId, nutritionalStatus, riskEmphasis, actions })),
      treatmentGuidance: care.treatmentGuidance.map(({ id, treatmentTypeId, nutritionalStatus, guidance }) => ({ id, treatmentTypeId, nutritionalStatus, guidance })),
      coMorbidities: care.coMorbidities.map(({ id, conditionId, label, guidance }) => ({ id, conditionId, label, guidance })),
      products: { status: care.products.status, plans: care.products.plans.map(({ id, stage, nutritionalStatus, products, dose, duration }) => ({ id, stage, nutritionalStatus, products, dose, duration })),
        ...(care.products.choices ? { choices: care.products.choices.map(({ id, stage, nutritionalStatus, products, dose, duration }) => ({ id, stage, nutritionalStatus, products, dose, duration })) } : {}),
        notes: care.products.notes.map(({ id, kind, label, guidance }) => ({ id, kind, label, guidance })), ...(care.products.reason ? { reason: care.products.reason } : {}) },
    },
  };
}

export type ReportEvidence = { id: string; text: string };
export function reportEvidence(facts: ReportContentRequest["facts"], classification: { id: string; label: string }, packet: ReturnType<typeof matchedReportPacket>): ReportEvidence[] {
  const evidence: ReportEvidence[] = [{ id: "fact:niq_risk", text: `NIQ risk: ${classification.label}; reviewed score ${facts.reviewedScore}` }];
  for (const row of facts.observations) {
    const [label, unit] = observationLabels[row.id];
    evidence.push({ id: `fact:${row.id}`, text: `${label}: ${row.value}${unit ? ` ${unit}` : ""}${row.measuredAt ? ` on ${row.measuredAt}` : ""}` });
  }
  for (const row of packet.nutritionInterventions) evidence.push({ id: `rule:${row.id}`, text: `${row.label}. ${row.coreStrategy}. ${row.clinicalActions}` });
  for (const row of packet.classGuidance) evidence.push({ id: `rule:class_${row.id}`, text: `${row.label}: ${row.guidance}` });
  // A rule can be selected by one questionnaire answer even when its source
  // title lists several effects, severity, or a named drug. The title is a
  // reference for guidance, not evidence that every named effect occurred.
  for (const row of packet.toxicityInterventions) evidence.push({ id: `rule:${row.id}`, text: `Nutrition guidance source topic: ${row.expectedToxicity}. ${row.nutritionalInterventions}` });
  // Possible effects are returned for a separately labelled visual section, but
  // never fed to the prose model as if they were observed patient findings.
  for (const row of packet.carePlan.statusModifiers) evidence.push({ id: `rule:${row.id}`, text: `${row.riskEmphasis}. ${row.actions}` });
  for (const row of packet.carePlan.treatmentGuidance) evidence.push({ id: `rule:${row.id}`, text: row.guidance });
  for (const row of packet.carePlan.coMorbidities) evidence.push({ id: `rule:${row.id}`, text: `${row.label}: ${row.guidance}` });
  for (const row of packet.carePlan.products.notes) evidence.push({ id: `rule:${row.id}`, text: `${row.label}: ${row.guidance}` });
  return evidence;
}

/** Local checks do not replace clinical review, but reject malformed and ungrounded numerals. */
export function validateNarrative(value: unknown, evidence: ReportEvidence[]): { narrative: ReportNarrative | null; issues: string[] } {
  const parsed = narrativeSchema.safeParse(value);
  if (!parsed.success) return { narrative: null, issues: ["INVALID_NARRATIVE_SCHEMA"] };
  const evidenceById = new Map(evidence.map(item => [item.id, item.text]));
  const issues: string[] = [];
  for (const [field, part] of Object.entries(parsed.data)) {
    const selected = part.evidenceIds.map(id => evidenceById.get(id));
    if (selected.some(text => text === undefined)) issues.push(`${field}:UNKNOWN_EVIDENCE_ID`);
    const sourceNumbers = new Set(selected.flatMap(text => text?.match(/\d+(?:\.\d+)?/g) ?? []));
    if ((part.text.match(/\d+(?:\.\d+)?/g) ?? []).some(number => !sourceNumbers.has(number))) issues.push(`${field}:UNSUPPORTED_NUMBER`);
    if (/\b(?:diagnosed with|has developed|is experiencing)\b/i.test(part.text) && part.evidenceIds.some(id => id.startsWith("possible:"))) issues.push(`${field}:POSSIBLE_EFFECT_AS_CONFIRMED`);
  }
  return { narrative: issues.length ? null : parsed.data, issues };
}
