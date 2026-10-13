import { z } from "zod";
import type { FinalAssessmentAnswers, FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { classOnlyToxicity, matchesToxicityAssessmentAnswers, resolveReportGuidance } from "@niq-scoring/contracts/report-guidance";
import { resolveCarePlanGuidance } from "@niq-scoring/contracts/care-plan-resolver";
import { productExceptionActionText } from "@niq-scoring/contracts/product-guidance";
import { cancerTypeIds } from "@niq-scoring/contracts/cancer-type-ids";

const id = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const ids = z.array(id).max(500);
const assessmentAnswersSchema = z.object({
  gastrointestinal_symptoms: ids.max(200).optional(),
  dietary_symptoms: ids.max(200).optional(),
  appetite_status: id.optional(),
  previous_weight_kg: z.number().finite().positive().max(1000).optional(),
  current_weight_kg: z.number().finite().positive().max(1000).optional(),
}).strict();
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
    assessmentAnswers: assessmentAnswersSchema.optional(),
    coMorbidityIds: ids.optional(),
    cancerTypeId: id.optional(),
    dietPreferenceId: z.enum(["vegetarian", "non_vegetarian", "eggetarian", "jain"]).optional(),
    treatmentStatusId: id.optional(),
    surgicalStatusId: id.optional(),
    surgeryDate: calendarDate.optional(),
    plannedSurgeryDate: calendarDate.optional(),
    plannedTreatmentStartDate: calendarDate.optional(),
    assessmentDate: calendarDate,
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
export const reportToxicityOptionsRequestSchema = z.object({
  assessmentReference: reference,
  resultReference: reference,
  treatmentTypeIds: ids,
  drugClassIds: ids,
}).strict();

const narrativePart = z.object({ text: z.string().trim().max(1200), evidenceIds: z.array(z.string().min(1).max(120)).max(20) })
  .strict().refine(part => Boolean(part.text) === (part.evidenceIds.length > 0), "A passage needs evidence; an omitted passage needs neither text nor evidence");
export const narrativeFieldNames = ["overview", "keyFindings", "actionSummary", "monitoringSummary",
  "nutritionAdvice", "treatmentAdvice", "conditionAdvice", "effectsAdvice"] as const;
export const narrativeSchema = z.object({
  overview: narrativePart,
  keyFindings: narrativePart,
  actionSummary: narrativePart,
  monitoringSummary: narrativePart,
  nutritionAdvice: narrativePart,
  treatmentAdvice: narrativePart,
  conditionAdvice: narrativePart,
  effectsAdvice: narrativePart,
}).strict();
export type ReportNarrative = z.infer<typeof narrativeSchema>;

/** Remove harmless model formatting before clinical validation and review. */
export function normalizeNarrativePunctuation(value: unknown): unknown {
  const parsed = narrativeSchema.safeParse(value);
  if (!parsed.success) return value;
  return Object.fromEntries(narrativeFieldNames.map(field => {
    const part = parsed.data[field];
    const text = part.text
      .replace(/;\s*([\p{L}])/gu, (_match, next: string) => `. ${next.toLocaleUpperCase()}`)
      .replace(/;/gu, ".")
      .replace(/\s*—\s*/gu, ", ")
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    return [field, { text, evidenceIds: part.evidenceIds }];
  })) as ReportNarrative;
}
export const reviewSchema = z.object({
  accepted: z.boolean(),
  issues: z.array(z.object({ field: z.enum(narrativeFieldNames), code: z.enum(["UNSUPPORTED_CLAIM", "UNSUPPORTED_NUMBER", "OVERSTATED_TOXICITY", "DRUG_SPECIFIC_CLAIM", "UNSAFE_INSTRUCTION", "UNCLEAR_WORDING"]), evidenceIds: z.array(z.string()).max(10), reason: z.string().trim().min(1).max(320).optional() }).strict()).max(10),
}).strict();

const narrativeJsonSchema = {
  type: "object", additionalProperties: false,
  required: narrativeFieldNames,
  properties: Object.fromEntries(narrativeFieldNames.map(key => [key, { type: "object", additionalProperties: false, required: ["text", "evidenceIds"], properties: { text: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } } }])),
};
export const writerJsonSchema = narrativeJsonSchema;
export const reviewerJsonSchema = {
  type: "object", additionalProperties: false, required: ["accepted", "issues"],
  properties: { accepted: { type: "boolean" }, issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "code", "evidenceIds", "reason"], properties: { field: { type: "string", enum: narrativeFieldNames }, code: { type: "string", enum: ["UNSUPPORTED_CLAIM", "UNSUPPORTED_NUMBER", "OVERSTATED_TOXICITY", "DRUG_SPECIFIC_CLAIM", "UNSAFE_INSTRUCTION", "UNCLEAR_WORDING"] }, evidenceIds: { type: "array", items: { type: "string" } }, reason: { type: "string", maxLength: 320 } } } } },
};

export function validateReportFacts(definition: FinalAssessmentDefinition, facts: ReportContentRequest["facts"]): boolean {
  const optionSet = (fieldId: string) => new Set(definition.sections.flatMap(section => section.fields)
    .filter(field => field.id === fieldId && "options" in field)
    .flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
  const answers = facts.assessmentAnswers;
  return !(
    !validateReportSelection(definition, facts.treatmentTypeIds, facts.drugClassIds) ||
    facts.coMorbidityIds?.some(value => !optionSet("co_morbidities").has(value)) ||
    facts.treatmentStatusId && !optionSet("treatment_status").has(facts.treatmentStatusId) ||
    facts.surgicalStatusId && !optionSet("cancer_surgical_status").has(facts.surgicalStatusId) ||
    facts.cancerTypeId && !cancerTypeIds.includes(facts.cancerTypeId as typeof cancerTypeIds[number]) ||
    facts.surgeryDate && facts.surgicalStatusId !== "cancer_surgical_status_done" ||
    facts.plannedSurgeryDate && facts.surgicalStatusId !== "cancer_surgical_status_planned" ||
    facts.drugClassIds.includes("other") && facts.confirmedToxicityIds.length > 0 ||
    facts.confirmedToxicityIds.some(confirmedId => !definition.reportGuidance?.toxicity.some(row => row.id === confirmedId && row.enabled
      && facts.drugClassIds.includes(row.classId) && facts.treatmentTypeIds.includes(row.treatmentTypeId)
      && row.match?.mode === "clinician_confirmation" && !classOnlyToxicity(row).requiresDrugConfirmation)) ||
    answers && Object.entries(answers).some(([fieldId, value]) => Array.isArray(value)
      ? value.some(optionId => !optionSet(fieldId).has(optionId)) || new Set(value).size !== value.length
      : typeof value === "string" && !optionSet(fieldId).has(value)) ||
    new Set(facts.observations.map(row => row.id)).size !== facts.observations.length
  );
}

export function validateReportSelection(definition: FinalAssessmentDefinition, treatmentTypeIds: string[], drugClassIds: string[]): boolean {
  const classes = new Set(definition.drugClassConfig?.classes.map(item => item.id) ?? []);
  const treatments = new Set(definition.sections.flatMap(section => section.fields)
    .filter(field => field.id === "current_cancer_treatment" && "options" in field)
    .flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
  return !drugClassIds.some(value => value !== "other" && !classes.has(value))
    && !(drugClassIds.includes("other") && drugClassIds.length > 1)
    && !treatmentTypeIds.some(value => !treatments.has(value));
}

export function eligibleClinicianToxicityOptions(definition: FinalAssessmentDefinition, treatmentTypeIds: string[], drugClassIds: string[]) {
  const classNames = new Map((definition.drugClassConfig?.classes ?? []).map(item => [item.id, item.label]));
  const treatmentNames = new Map(definition.sections.flatMap(section => section.fields)
    .filter(field => field.id === "current_cancer_treatment" && "options" in field)
    .flatMap(field => "options" in field ? field.options.map(option => [option.id, option.label] as const) : []));
  return (definition.reportGuidance?.toxicity ?? []).filter(row => row.enabled && row.match?.mode === "clinician_confirmation"
    && treatmentTypeIds.includes(row.treatmentTypeId) && drugClassIds.includes(row.classId)
    && !classOnlyToxicity(row).requiresDrugConfirmation)
    .map(row => {
      const safe = classOnlyToxicity(row);
      return { id: safe.id, classId: safe.classId, classLabel: classNames.get(safe.classId) ?? safe.classId,
        treatmentTypeId: safe.treatmentTypeId, treatmentTypeLabel: treatmentNames.get(safe.treatmentTypeId) ?? safe.treatmentTypeId,
        expectedToxicity: safe.expectedToxicity };
    });
}

function matchedToxicityIds(definition: FinalAssessmentDefinition, facts: ReportContentRequest["facts"]): string[] {
  const answers = Object.fromEntries(Object.entries(facts.assessmentAnswers ?? {}).filter(([, value]) => value !== undefined)) as FinalAssessmentAnswers;
  const automatic = (definition.reportGuidance?.toxicity ?? []).filter(row => row.enabled && row.match
    && row.match.mode !== "clinician_confirmation" && facts.drugClassIds.includes(row.classId)
    && facts.treatmentTypeIds.includes(row.treatmentTypeId) && !classOnlyToxicity(row).requiresDrugConfirmation
    && matchesToxicityAssessmentAnswers(row.match, answers)).map(row => row.id);
  return [...new Set([...automatic, ...facts.confirmedToxicityIds])];
}

function matchedAnswerLabels(definition: FinalAssessmentDefinition, facts: ReportContentRequest["facts"], rowId: string): string[] {
  const match = definition.reportGuidance?.toxicity.find(row => row.id === rowId)?.match;
  if (match?.mode !== "assessment_answer") return [];
  return match.anyOf.flatMap(({ fieldId, optionId }) => {
    const answer = (facts.assessmentAnswers as Record<string, string | string[] | number | undefined> | undefined)?.[fieldId];
    if (answer !== optionId && (!Array.isArray(answer) || !answer.includes(optionId))) return [];
    const field = definition.sections.flatMap(section => section.fields).find(item => item.id === fieldId);
    if (!field || !("options" in field)) return [];
    const label = field.options.find(option => option.id === optionId)?.label;
    return label ? [label] : [];
  });
}

export function matchedReportPacket(definition: FinalAssessmentDefinition, facts: ReportContentRequest["facts"], riskCategoryId: string, asOfDate: string) {
  const report = resolveReportGuidance(definition, { riskCategoryId, treatmentTypeIds: facts.treatmentTypeIds, drugClassIds: facts.drugClassIds, confirmedToxicityIds: matchedToxicityIds(definition, facts) });
  const care = resolveCarePlanGuidance(definition, { riskCategoryId, treatmentTypeIds: facts.treatmentTypeIds, drugClassIds: facts.drugClassIds, coMorbidityIds: facts.coMorbidityIds ?? [], cancerTypeId: facts.cancerTypeId ?? null, dietPreferenceId: facts.dietPreferenceId ?? null, treatmentStatusId: facts.treatmentStatusId ?? null, surgicalStatusId: facts.surgicalStatusId ?? null, surgeryDate: facts.surgeryDate ?? null, plannedSurgeryDate: facts.plannedSurgeryDate ?? null, plannedTreatmentStartDate: facts.plannedTreatmentStartDate ?? null, productStageChoice: facts.productStageChoice ?? null, asOfDate });
  return {
    nutritionInterventions: report.nutrition.map(({ id, label, coreStrategy, clinicalActions }) => ({ id, label, coreStrategy, clinicalActions })),
    toxicityInterventions: report.toxicity.map(({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions }) => ({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions,
      matchSource: definition.reportGuidance?.toxicity.find(row => row.id === id)?.match?.mode ?? "unknown",
      matchedAnswerLabels: matchedAnswerLabels(definition, facts, id) })),
    // Give the report agent every enabled intervention for the selected
    // treatment and drug class. These are options, not observed symptoms.
    possibleToxicities: report.possibleToxicities.map(({ id, classId, treatmentTypeId, nutritionalInterventions, requiresDrugConfirmation }) =>
      ({ id, classId, treatmentTypeId, nutritionalInterventions, requiresDrugConfirmation })),
    classGuidance: report.classGuidance,
    carePlan: {
      nutritionalStatus: care.nutritionalStatus,
      statusModifiers: care.statusModifiers.map(({ id, classId, treatmentTypeId, nutritionalStatus, riskEmphasis, actions }) => ({ id, classId, treatmentTypeId, nutritionalStatus, riskEmphasis, actions })),
      treatmentGuidance: care.treatmentGuidance.map(({ id, treatmentTypeId, nutritionalStatus, guidance }) => ({ id, treatmentTypeId, nutritionalStatus, guidance })),
      coMorbidities: care.coMorbidities.map(({ id, conditionId, label, guidance }) => ({ id, conditionId, label, guidance })),
      products: { status: care.products.status, plans: care.products.plans.map(({ id, stage, nutritionalStatus, products, dose, duration, items }) => ({ id, stage, nutritionalStatus, products, dose, duration, ...(items ? { items } : {}) })),
        ...(care.products.choices ? { choices: care.products.choices.map(({ id, stage, nutritionalStatus, products, dose, duration, items }) => ({ id, stage, nutritionalStatus, products, dose, duration, ...(items ? { items } : {}) })) } : {}),
        // Exception wording is meaningful only with a selected product plan.
        notes: care.products.status === "selected"
          ? care.products.notes.map(({ id, kind, label, match, action, guidance }) => ({ id, kind, label, match, action, guidance }))
          : [], ...(care.products.reason ? { reason: care.products.reason } : {}) },
    },
  };
}

export type ReportEvidence = { id: string; text: string };
export function reportEvidence(definition: FinalAssessmentDefinition, facts: ReportContentRequest["facts"], classification: { id: string; label: string }, packet: ReturnType<typeof matchedReportPacket>): ReportEvidence[] {
  const evidence: ReportEvidence[] = [{ id: "fact:niq_risk", text: `NIQ risk: ${classification.label}; reviewed score ${facts.reviewedScore}` }];
  const { previous_weight_kg: previousWeight, current_weight_kg: currentWeight } = facts.assessmentAnswers ?? {};
  if (previousWeight !== undefined && currentWeight !== undefined) {
    const direction = previousWeight > currentWeight ? "loss" : previousWeight < currentWeight ? "gain" : "no change";
    const percentage = Math.round(Math.abs(previousWeight - currentWeight) / previousWeight * 1000) / 10;
    evidence.push({ id: "fact:weight_direction", text: `Recorded weight ${direction}: ${previousWeight} kg previously and ${currentWeight} kg currently (${percentage}%). The interval between measurements was not supplied.` });
  }
  if (facts.dietPreferenceId) {
    const dietNames = { vegetarian: "Vegetarian", non_vegetarian: "Non-vegetarian", eggetarian: "Eggetarian", jain: "Jain (no eggs, fish, or meat)" };
    evidence.push({ id: "fact:diet_preference", text: `Reported diet preference: ${dietNames[facts.dietPreferenceId]}` });
  }
  for (const row of facts.observations) {
    const [label, unit] = observationLabels[row.id];
    evidence.push({ id: `fact:${row.id}`, text: `${label}: ${row.value}${unit ? ` ${unit}` : ""}${row.measuredAt ? ` on ${row.measuredAt}` : ""}` });
  }
  for (const row of packet.nutritionInterventions) evidence.push({ id: `rule:nutrition:${row.id}`, text: `${row.label}. ${row.coreStrategy}. ${row.clinicalActions}` });
  for (const row of packet.classGuidance) evidence.push({ id: `rule:class:${row.id}`, text: `${row.label}: ${row.guidance}` });
  for (const row of packet.possibleToxicities) evidence.push({
    id: `possible:toxicity:${row.id}`,
    text: `Candidate guidance for the selected treatment and drug class. This is not evidence that the patient has an effect.${row.requiresDrugConfirmation ? " Named-drug confirmation is required before applying this drug-specific advice." : ""} ${row.nutritionalInterventions}`,
  });
  // Source titles can combine effects. Separate observed facts from the
  // guidance text so the model cannot use the title as symptom evidence.
  for (const row of packet.toxicityInterventions) {
    evidence.push({ id: `rule:toxicity:${row.id}`, text: `Nutrition guidance for a matched treatment effect: ${row.nutritionalInterventions}` });
    const source = definition.reportGuidance?.toxicity.find(item => item.id === row.id);
    if (source?.match?.mode === "clinician_confirmation") {
      evidence.push({ id: `fact:clinician_toxicity_${row.id}`, text: `Clinician confirmed treatment effect: ${row.expectedToxicity}` });
    } else if (source?.match?.mode === "weight_change") {
      const { previous_weight_kg: previous, current_weight_kg: current } = facts.assessmentAnswers ?? {};
      evidence.push({ id: `fact:weight_change_${row.id}`, text: `Recorded weight ${source.match.direction}: ${previous} kg previously and ${current} kg currently` });
    } else if (source?.match?.mode === "assessment_answer") {
      for (const [index, label] of matchedAnswerLabels(definition, facts, row.id).entries())
        evidence.push({ id: `fact:assessment_${row.id}_${index}`, text: `Patient reported ${label}` });
    }
  }
  for (const row of packet.carePlan.statusModifiers) evidence.push({ id: `rule:status:${row.id}`, text: `${row.riskEmphasis}. ${row.actions}` });
  for (const row of packet.carePlan.treatmentGuidance) evidence.push({ id: `rule:treatment:${row.id}`, text: row.guidance });
  for (const row of packet.carePlan.coMorbidities) evidence.push({ id: `rule:comorbidity:${row.id}`, text: `${row.label}: ${row.guidance}` });
  for (const row of packet.carePlan.products.notes) evidence.push({ id: `rule:exception:${row.id}`,
    text: `${row.label}: ${row.action ? productExceptionActionText(row.action) : row.guidance}${row.action && row.guidance ? ` Explanation: ${row.guidance}` : ""}` });
  if (packet.carePlan.products.status === "selected") {
    for (const row of packet.carePlan.products.plans) {
      const details = row.items?.map(item => `${item.productName}: ${item.quantityPerDay === undefined ? item.description
        : item.productName === "Liss WH" && item.description === "leveled scoops in 150ml water"
          ? `${item.quantityPerDay} ${item.description}`
          : `${item.quantityPerDay} per day${item.description ? `; description: ${item.description}` : ""}`}`).join(". ");
      evidence.push({ id: `rule:product:${row.id}`, text: details
        ? `Selected product plan: ${row.products}. Dosage and preparation: ${details}. Duration: ${row.duration}.`
        : `Selected product plan: ${row.products}. Dose: ${row.dose}. Duration: ${row.duration}.` });
    }
  }
  return evidence;
}

/** Remove only passages the final checks could not support, retaining reviewed sections. */
export function omitNarrativeFields(value: unknown, fields: ReadonlySet<string>): ReportNarrative | null {
  const parsed = narrativeSchema.safeParse(value);
  if (!parsed.success) return null;
  return Object.fromEntries(narrativeFieldNames.map(field => [field,
    fields.has(field) ? { text: "", evidenceIds: [] } : parsed.data[field]])) as ReportNarrative;
}

function copiesGuidance(text: string, sources: string[]): boolean {
  const words = (value: string) => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const passage = words(text);
  if (passage.length < 8) return false;
  const span = Math.min(14, passage.length);
  return sources.some(source => {
    const sourceText = words(source).join(" ");
    for (let index = 0; index <= passage.length - span; index++)
      if (sourceText.includes(passage.slice(index, index + span).join(" "))) return true;
    return false;
  });
}

/** Local checks do not replace clinical review, but reject malformed and ungrounded numerals. */
export function validateNarrative(value: unknown, evidence: ReportEvidence[]): { narrative: ReportNarrative | null; issues: string[] } {
  const parsed = narrativeSchema.safeParse(value);
  if (!parsed.success) return { narrative: null, issues: ["INVALID_NARRATIVE_SCHEMA"] };
  const evidenceById = new Map(evidence.map(item => [item.id, item.text]));
  const requiredGuidance: Partial<Record<keyof ReportNarrative, readonly string[]>> = {
    nutritionAdvice: ["rule:nutrition:"],
    treatmentAdvice: ["rule:status:", "rule:treatment:", "rule:class:", "rule:exception:", "possible:toxicity:"],
    conditionAdvice: ["rule:comorbidity:"],
    effectsAdvice: ["rule:toxicity:"],
  };
  const issues: string[] = [];
  // Matched guidance must not disappear merely because the model returned an
  // empty field and the reviewer accepted it.
  for (const [field, prefixes] of [
    ["nutritionAdvice", ["rule:nutrition:"]],
    ["treatmentAdvice", ["rule:status:", "rule:treatment:", "rule:class:"]],
    ["conditionAdvice", ["rule:comorbidity:"]],
    ["effectsAdvice", ["rule:toxicity:"]],
  ] as const) {
    const required = evidence.filter(item => prefixes.some(prefix => item.id.startsWith(prefix)));
    if (required.some(item => !parsed.data[field].evidenceIds.includes(item.id)))
      issues.push(`${field}:MISSING_MATCHED_COVERAGE`);
  }
  const renalTargetsIndividualized = evidence.some(item => item.id.startsWith("rule:comorbidity:") &&
    /\b(?:kidney|renal)\b/i.test(item.text) && /\bindividuali[sz]/i.test(item.text));
  if (renalTargetsIndividualized) {
    for (const field of ["nutritionAdvice", "treatmentAdvice"] as const) {
      const sentences = parsed.data[field].text.split(/(?<=[.!?])\s+/u);
      if (sentences.some(sentence => /\b\d+(?:[.\u2013\u2014-]\d+)?\s*(?:kcal\/kg(?:\/day)?|g(?:\s+protein)?\/kg(?:\/day)?)\b/i.test(sentence)))
        issues.push(`${field}:RENAL_FIXED_TARGET_NEEDS_TEAM`);
      if (sentences.some(sentence =>
        /\b(?:aim for|consume|drink|keep fluids up|increase fluids?)\b/i.test(sentence) && /\b(?:\d+(?:\.\d+)?|fluids?)\b/i.test(sentence) ||
        /\btarget\b/i.test(sentence) && /\d/u.test(sentence) &&
          !/\b(?:individuali[sz]|as advised|care team|clinician|doctor)\b/i.test(sentence)))
        issues.push(`${field}:RENAL_TARGET_NEEDS_QUALIFICATION`);
    }
    for (const field of ["nutritionAdvice", "treatmentAdvice", "conditionAdvice", "effectsAdvice"] as const) {
      const sentences = parsed.data[field].text.split(/(?<=[.!?])\s+/u);
      if (sentences.some(sentence => /^\s*(?:include|eat|choose|add|increase)\b/i.test(sentence)
        && /\b(?:potassium|magnesium)\b/i.test(sentence)))
        issues.push(`${field}:RENAL_ELECTROLYTE_FOODS_NEED_APPROVAL`);
      if (sentences.some(sentence =>
        /\b(?:try|eat|include|choose|have|add|use|take)\b.{0,80}\b(?:banana|coconut water|potato(?:es)?|spinach|avocado)\b/i.test(sentence)
        && !/\b(?:ask (?:your )?(?:care )?team|discuss with (?:your )?(?:care )?team|as (?:advised|directed|recommended) by|if (?:your )?(?:care )?team (?:advises|recommends|approves)|with (?:your )?(?:care )?team(?:'s)? approval)\b/i.test(sentence)))
        issues.push(`${field}:RENAL_FOOD_EXAMPLE_NEEDS_APPROVAL`);
      if (sentences.some(sentence =>
        (/\b(?:drink|sip|increase)\b.{0,80}\b(?:fluids?|water|ORS)\b/i.test(sentence)
          || /\b(?:take|use|try)\b.{0,80}\b(?:ORS|oral rehydration)\b/i.test(sentence)
          || /\bkeep fluids up\b/i.test(sentence))
        && !/\b(?:ask (?:your )?(?:care )?team|discuss with (?:your )?(?:care )?team|as (?:advised|directed|recommended) by|if (?:your )?(?:care )?team (?:advises|recommends|approves)|with (?:your )?(?:care )?team(?:'s)? approval)\b/i.test(sentence)))
        issues.push(`${field}:RENAL_FLUID_ADVICE_NEEDS_APPROVAL`);
    }
  }
  const productNames = evidence.filter(item => item.id.startsWith("rule:product:"))
    .flatMap(item => /^Selected product plan: ([^.]+)\./.exec(item.text)?.[1]?.split(/\s+\+\s+/) ?? []);
  if (productNames.some(name => name.length > 3 && parsed.data.actionSummary.text.split(/[.!?]/u).some(sentence =>
    new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence) &&
    /\b(?:\d+|product|supplement|serving|dose|take|daily|per day)\b/i.test(sentence))))
    issues.push("actionSummary:REPEATS_PRODUCT_PLAN");
  for (const [field, part] of Object.entries(parsed.data)) {
    const selected = part.evidenceIds.map(id => evidenceById.get(id));
    if (selected.some(text => text === undefined)) issues.push(`${field}:UNKNOWN_EVIDENCE_ID`);
    if (part.evidenceIds.some(id => id.startsWith("possible:toxicity:") &&
      evidenceById.get(id)?.includes("Named-drug confirmation is required")))
      issues.push(`${field}:DRUG_SPECIFIC_CANDIDATE_UNVERIFIED`);
    const prefixes = requiredGuidance[field as keyof ReportNarrative];
    if (part.text && prefixes && !part.evidenceIds.some(id => prefixes.some(prefix => id.startsWith(prefix))))
      issues.push(`${field}:MISSING_MATCHED_GUIDANCE`);
    if (part.text && prefixes && copiesGuidance(part.text, part.evidenceIds.filter(id => id.startsWith("rule:") || id.startsWith("possible:"))
      .map(id => evidenceById.get(id)).filter((source): source is string => Boolean(source))))
      issues.push(`${field}:COPIED_GUIDANCE`);
    const sourceNumbers = new Set(selected.flatMap(text => text?.match(/\d+(?:\.\d+)?/g) ?? []));
    if ((part.text.match(/\d+(?:\.\d+)?/g) ?? []).some(number => !sourceNumbers.has(number))) issues.push(`${field}:UNSUPPORTED_NUMBER`);
    const maxWords = field === "treatmentAdvice" ? 160 : /Advice$/u.test(field) ? 120 : 80;
    if (part.text.trim().split(/\s+/u).length > maxWords) issues.push(`${field}:FIELD_TOO_LONG`);
    if (/\b(?:hba1c|h1bac|hb\s*a1c|a1c|glycated\s+ha?emoglobin)\b/i.test(part.text)) issues.push(`${field}:EXCLUDED_REPORT_TERM`);
    if (/\b75%\s+of\s+(?:your\s+)?(?:usual|previous|normal)\s+(?:oral\s+)?intake\b/i.test(part.text)) issues.push(`${field}:INTAKE_DENOMINATOR_UNCLEAR`);
    if (/\b2\.3\s*g\b.{0,100}\b5\s*g\s+(?:of\s+)?salt\b|\b5\s*g\s+(?:of\s+)?salt\b.{0,100}\b2\.3\s*g\b/i.test(part.text))
      issues.push(`${field}:SODIUM_SALT_EQUIVALENCE_MISMATCH`);
    if (/\b(?:diagnosed with|has developed|is experiencing)\b/i.test(part.text) && part.evidenceIds.some(id => id.startsWith("possible:"))) issues.push(`${field}:POSSIBLE_EFFECT_AS_CONFIRMED`);
    if (/[;—\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(part.text)) issues.push(`${field}:REPORT_STYLE`);
  }
  return { narrative: issues.length ? null : parsed.data, issues };
}
