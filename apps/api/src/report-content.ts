import { z } from "zod";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { classOnlyToxicity, resolveReportGuidance } from "@niq-scoring/contracts/report-guidance";
import { resolveCarePlanGuidance } from "@niq-scoring/contracts/care-plan-resolver";
import { productExceptionActionText, productIdentityName, productPlanItems } from "@niq-scoring/contracts/product-guidance";
import { cancerTypeIds, cancerTypeLabels } from "@niq-scoring/contracts/cancer-type-ids";
import type { Product } from "./product-catalog";

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

// The writer may exceed its final word budget before a focused repair. Keep
// intermediate prose parseable so the repair loop can shorten it safely.
const narrativePart = z.object({ text: z.string().trim().max(4000), evidenceIds: z.array(z.string().min(1).max(120)).max(100) })
  .strict().refine(part => Boolean(part.text) === (part.evidenceIds.length > 0), "A passage needs evidence; an omitted passage needs neither text nor evidence");
export const narrativeFieldNames = ["overview", "keyFindings", "actionSummary", "monitoringSummary", "overallSummary",
  "nutritionAdvice", "treatmentAdvice", "conditionAdvice", "effectsAdvice", "foodSafetyAdvice", "redFlagsAdvice"] as const;
export const narrativeSchema = z.object({
  overview: narrativePart,
  keyFindings: narrativePart,
  actionSummary: narrativePart,
  monitoringSummary: narrativePart,
  overallSummary: narrativePart,
  nutritionAdvice: narrativePart,
  treatmentAdvice: narrativePart,
  conditionAdvice: narrativePart,
  effectsAdvice: narrativePart,
  // Optional for nine-field reports already in storage. Fresh writer JSON
  // still requires both fields through writerJsonSchema.
  foodSafetyAdvice: narrativePart.optional(),
  redFlagsAdvice: narrativePart.optional(),
}).strict();
export type ReportNarrative = z.input<typeof narrativeSchema>;
export type CompleteReportNarrative = Omit<z.output<typeof narrativeSchema>, "foodSafetyAdvice" | "redFlagsAdvice">
  & { foodSafetyAdvice: z.infer<typeof narrativePart>; redFlagsAdvice: z.infer<typeof narrativePart> };

function completeNarrative(value: z.output<typeof narrativeSchema>): CompleteReportNarrative {
  const empty = { text: "", evidenceIds: [] as string[] };
  return { ...value, foodSafetyAdvice: value.foodSafetyAdvice ?? empty, redFlagsAdvice: value.redFlagsAdvice ?? empty };
}

/** Remove harmless model formatting before clinical validation and review. */
export function normalizeNarrativePunctuation(value: unknown): unknown {
  const parsed = narrativeSchema.safeParse(value);
  if (!parsed.success) return value;
  return Object.fromEntries(narrativeFieldNames.filter(field => parsed.data[field] !== undefined).map(field => {
    const part = parsed.data[field]!;
    const text = part.text
      .replace(/;\s*([\p{L}])/gu, (_match, next: string) => `. ${next.toLocaleUpperCase()}`)
      .replace(/;/gu, ".")
      .replace(/\s*—\s*/gu, ", ")
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu, "")
      .replace(/\r\n?/gu, "\n")
      .replace(/[ \t]*\n[ \t]*/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .split("\n").map(line => line.replace(/[ \t]+/gu, " ").trim()).join("\n")
      .trim();
    return [field, { text, evidenceIds: part.evidenceIds }];
  })) as ReportNarrative;
}
export const reviewSchema = z.object({
  accepted: z.boolean(),
  issues: z.array(z.object({ field: z.enum(narrativeFieldNames), code: z.enum(["UNSUPPORTED_CLAIM", "UNSUPPORTED_NUMBER", "OVERSTATED_TOXICITY", "DRUG_SPECIFIC_CLAIM", "UNSAFE_INSTRUCTION", "UNCLEAR_WORDING"]), evidenceIds: z.array(z.string()).max(20), reason: z.string().trim().min(1).max(500).optional() }).strict()).max(40),
}).strict();

const narrativeJsonSchema = {
  type: "object", additionalProperties: false,
  required: narrativeFieldNames,
  properties: Object.fromEntries(narrativeFieldNames.map(key => [key, { type: "object", additionalProperties: false, required: ["text", "evidenceIds"], properties: { text: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } } }])),
};
export const writerJsonSchema = narrativeJsonSchema;
export const reviewerJsonSchema = {
  type: "object", additionalProperties: false, required: ["accepted", "issues"],
  properties: { accepted: { type: "boolean" }, issues: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false, required: ["field", "code", "evidenceIds", "reason"], properties: { field: { type: "string", enum: narrativeFieldNames }, code: { type: "string", enum: ["UNSUPPORTED_CLAIM", "UNSUPPORTED_NUMBER", "OVERSTATED_TOXICITY", "DRUG_SPECIFIC_CLAIM", "UNSAFE_INSTRUCTION", "UNCLEAR_WORDING"] }, evidenceIds: { type: "array", items: { type: "string" }, maxItems: 20 }, reason: { type: "string", maxLength: 500 } } } } },
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

export function matchedReportPacket(definition: FinalAssessmentDefinition, facts: ReportContentRequest["facts"], riskCategoryId: string, asOfDate: string, catalog: Product[] = []) {
  // All class-and-treatment matches are conditional candidate guidance. A
  // questionnaire symptom or historical row match never promotes one to a
  // mandatory treatment-effect rule.
  const report = resolveReportGuidance(definition, { riskCategoryId, treatmentTypeIds: facts.treatmentTypeIds, drugClassIds: facts.drugClassIds, confirmedToxicityIds: [] });
  const care = resolveCarePlanGuidance(definition, { riskCategoryId, treatmentTypeIds: facts.treatmentTypeIds, drugClassIds: facts.drugClassIds, coMorbidityIds: facts.coMorbidityIds ?? [], cancerTypeId: facts.cancerTypeId ?? null, dietPreferenceId: facts.dietPreferenceId ?? null, treatmentStatusId: facts.treatmentStatusId ?? null, surgicalStatusId: facts.surgicalStatusId ?? null, surgeryDate: facts.surgeryDate ?? null, plannedSurgeryDate: facts.plannedSurgeryDate ?? null, plannedTreatmentStartDate: facts.plannedTreatmentStartDate ?? null, productStageChoice: facts.productStageChoice ?? null, asOfDate });
  const selectedNames = new Set(care.products.plans.flatMap(plan => (plan.items?.map(item => item.productName)
    ?? plan.productNames ?? plan.products.split(" + ").map(name => name.trim())).map(productIdentityName)));
  const productDetails = care.products.status === "selected" ? catalog.filter(product =>
    [product.name, ...product.aliases].some(name => selectedNames.has(productIdentityName(name))))
    .map(({ id, name, description, aliases, benefits }) => ({ id, name, description, aliases, benefits: benefits ?? [] })) : [];
  const publicPlan = (plan: (typeof care.products.plans)[number]) => {
    const { id, stage, nutritionalStatus, products, dose, duration, durationAmount } = plan;
    const items = productPlanItems(plan);
    return { id, stage, nutritionalStatus, products, dose, duration,
      ...(durationAmount ? { durationAmount } : {}), ...(items.length ? { items } : {}) };
  };
  return {
    nutritionInterventions: report.nutrition.map(({ id, label, coreStrategy, clinicalActions }) => ({ id, label, coreStrategy, clinicalActions })),
    toxicityInterventions: report.toxicity.map(({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions }) =>
      ({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions })),
    // Give the report agent every enabled intervention for the selected
    // treatment and drug class. These are options, not observed symptoms.
    possibleToxicities: report.possibleToxicities.filter(row => !row.requiresDrugConfirmation)
      .map(({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions, requiresDrugConfirmation }) =>
        ({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions, requiresDrugConfirmation })),
    classGuidance: report.classGuidance,
    carePlan: {
      nutritionalStatus: care.nutritionalStatus,
      statusModifiers: care.statusModifiers.map(({ id, classId, treatmentTypeId, nutritionalStatus, riskEmphasis, actions }) => ({ id, classId, treatmentTypeId, nutritionalStatus, riskEmphasis, actions })),
      treatmentGuidance: care.treatmentGuidance.map(({ id, treatmentTypeId, nutritionalStatus, guidance }) => ({ id, treatmentTypeId, nutritionalStatus, guidance })),
      coMorbidities: care.coMorbidities.map(({ id, conditionId, label, guidance }) => ({ id, conditionId, label, guidance })),
      products: { status: care.products.status, catalog: productDetails, plans: care.products.plans.map(publicPlan),
        ...(care.products.choices ? { choices: care.products.choices.map(publicPlan) } : {}),
        // Exception wording is meaningful only with a selected product plan.
        notes: care.products.status === "selected"
          ? care.products.notes.map(({ id, kind, label, match, action, guidance }) => ({ id, kind, label, match, action, guidance }))
          : [], ...(care.products.reason ? { reason: care.products.reason } : {}) },
    },
  };
}

export type ReportEvidence = { id: string; text: string };

/** True only when kidney disease is an explicitly matched comorbidity row. */
export function hasMatchedKidneyCondition(evidence: ReportEvidence[]): boolean {
  return evidence.some(item => {
    if (!item.id.startsWith("rule:comorbidity:")) return false;
    const label = item.text.split(":", 1)[0]!.trim();
    return /\b(?:kidney|renal|CKD|ESRD)\b/i.test(`${item.id.replace(/[_-]/gu, " ")} ${label}`);
  });
}
export function reportEvidence(definition: FinalAssessmentDefinition, facts: ReportContentRequest["facts"], classification: { id: string; label: string }, packet: ReturnType<typeof matchedReportPacket>): ReportEvidence[] {
  const evidence: ReportEvidence[] = [{ id: "fact:niq_risk", text: `NIQ risk: ${classification.label}; reviewed score ${facts.reviewedScore}` }];
  const optionLabel = (fieldId: string, optionId: string) => {
    const field = definition.sections.flatMap(section => section.fields).find(item => item.id === fieldId);
    return field && "options" in field ? field.options.find(option => option.id === optionId)?.label : undefined;
  };
  if (facts.treatmentStatusId) {
    const label = optionLabel("treatment_status", facts.treatmentStatusId);
    if (label) evidence.push({ id: "fact:treatment_status", text: `Recorded treatment status: ${label}.` });
  }
  for (const treatmentId of facts.treatmentTypeIds) {
    const label = optionLabel("current_cancer_treatment", treatmentId);
    if (label) evidence.push({ id: `fact:treatment_type_${treatmentId}`,
      text: `${facts.plannedTreatmentStartDate && facts.plannedTreatmentStartDate > facts.assessmentDate ? "Recorded planned cancer treatment modality" : "Recorded current cancer treatment"}: ${label}.` });
  }
  if (facts.plannedTreatmentStartDate && facts.plannedTreatmentStartDate > facts.assessmentDate) {
    evidence.push({ id: "fact:planned_treatment_start", text: `Treatment is planned to start on ${facts.plannedTreatmentStartDate}. This date is after the assessment date ${facts.assessmentDate}, so treatment is not confirmed as already underway.` });
  }
  const nutritionalStatus = packet.carePlan.nutritionalStatus;
  if (nutritionalStatus) {
    const labels = { well_nourished: "Well nourished", moderately_nourished: "Moderately nourished", severely_malnourished: "Severely malnourished" } as const;
    evidence.push({ id: "fact:nutritional_status", text: `Nutritional status for this risk category: ${labels[nutritionalStatus]}.` });
  }
  if (facts.cancerTypeId && facts.cancerTypeId !== "cancer_other" && facts.cancerTypeId !== "cancer_unknown") {
    const diagnosis = cancerTypeLabels[facts.cancerTypeId as (typeof cancerTypeIds)[number]];
    evidence.push({ id: "fact:diagnosis", text: `Recorded cancer diagnosis: ${diagnosis}.` });
  }
  for (const fieldId of ["gastrointestinal_symptoms", "dietary_symptoms", "appetite_status"] as const) {
    const answer = facts.assessmentAnswers?.[fieldId];
    const selected = typeof answer === "string" ? [answer] : answer ?? [];
    const field = definition.sections.flatMap(section => section.fields).find(item => item.id === fieldId);
    if (!field || !("options" in field)) continue;
    for (const optionId of selected) {
      const label = field.options.find(option => option.id === optionId)?.label;
      if (label) evidence.push({ id: `fact:assessment_${fieldId}_${optionId}`, text: `Assessment records ${field.label}: ${label}. This does not establish a treatment cause.` });
    }
  }
  for (const rowId of new Set(facts.confirmedToxicityIds)) {
    const row = definition.reportGuidance?.toxicity.find(item => item.id === rowId);
    if (row) evidence.push({ id: `fact:clinician_toxicity_${rowId}`,
      text: `Clinician explicitly confirmed ${classOnlyToxicity(row).expectedToxicity}. This confirmation does not select or require a guidance row.` });
  }
  const { previous_weight_kg: previousWeight, current_weight_kg: currentWeight } = facts.assessmentAnswers ?? {};
  if (previousWeight !== undefined && currentWeight !== undefined) {
    const direction = previousWeight > currentWeight ? "loss" : previousWeight < currentWeight ? "gain" : "no change";
    const percentage = Math.round(Math.abs(previousWeight - currentWeight) / previousWeight * 1000) / 10;
    // This assessment input now explicitly asks for weight one month ago.
    // Existing demo assessments use the same interpretation by agreement.
    const timing = "The previous weight was reported for 1 month ago.";
    evidence.push({ id: "fact:weight_direction", text: `Recorded weight ${direction}: ${previousWeight} kg previously and ${currentWeight} kg currently (${percentage}%). ${timing}` });
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
  for (const row of packet.possibleToxicities) {
    // An unresolved named-drug row is not available to patient-facing generation.
    if (row.requiresDrugConfirmation) continue;
    const source = definition.reportGuidance?.toxicity.find(item => item.id === row.id);
    const effect = source ? classOnlyToxicity(source).expectedToxicity : row.id;
    evidence.push({
    id: `possible:toxicity:${row.id}`,
    text: `Conditional class-and-treatment candidate: ${effect}. This is a possible effect, not a patient symptom or treatment causation. Source guidance: ${row.nutritionalInterventions}`,
    });
  }
  for (const row of packet.toxicityInterventions)
    evidence.push({ id: `rule:toxicity:${row.id}`, text: `Nutrition guidance for a matched treatment effect: ${row.nutritionalInterventions}` });
  for (const row of packet.carePlan.statusModifiers) evidence.push({ id: `rule:status:${row.id}`, text: `${row.riskEmphasis}. ${row.actions}` });
  for (const row of packet.carePlan.treatmentGuidance) evidence.push({ id: `rule:treatment:${row.id}`, text: row.guidance });
  for (const row of packet.carePlan.coMorbidities) evidence.push({ id: `rule:comorbidity:${row.id}`, text: `${row.label}: ${row.guidance}` });
  for (const row of packet.carePlan.products.notes) {
    // A removal is enforced when resolving the selected plan and remains
    // internal; there is no patient-facing exclusion paragraph to cite.
    if (row.action?.type === "remove") continue;
    evidence.push({ id: `rule:exception:${row.id}`,
      text: `${row.label}: ${row.action ? productExceptionActionText(row.action) : row.guidance}${row.action && row.guidance ? ` Explanation: ${row.guidance}` : ""}` });
  }
  for (const product of packet.carePlan.products.catalog) {
    const details = product.benefits.length ? product.benefits.map(benefit => `• ${benefit}`).join("\n") : product.description;
    if (details) evidence.push({ id: `catalog:product:${product.id}`, text: `${product.name}: ${details}. Product benefits only; dose and timing come from the selected plan.` });
  }
  if (packet.carePlan.products.status === "selected") {
    for (const row of packet.carePlan.products.plans) {
      const details = row.items?.map(item => `${item.productName}: ${[
        item.quantityPerDay === undefined ? item.description : item.unit ? `${item.quantityPerDay} ${item.unit} per day`
          : item.productName === "Liss WH" && item.description === "leveled scoops in 150ml water"
            ? `${item.quantityPerDay} ${item.description}` : `${item.quantityPerDay} per day`,
        item.timesPerDay ? item.timesPerDay === 1 ? "taken once per day" : `taken ${item.timesPerDay} times per day` : undefined,
        item.preparation ? `prepare: ${item.preparation}` : item.description && item.quantityPerDay !== undefined
          && !(item.productName === "Liss WH" && item.description === "leveled scoops in 150ml water") ? `description: ${item.description}` : undefined,
        item.mealTiming ? `meal timing: ${item.mealTiming}` : undefined,
        item.rationale ? `approved reason: ${item.rationale}` : undefined,
      ].filter(Boolean).join("; ")}`).join(". ");
      evidence.push({ id: `rule:product:${row.id}`, text: details
        ? `Selected product plan: ${row.products}. Dosage and preparation: ${details}. Duration: ${row.duration}.`
        : `Selected product plan: ${row.products}. Dose: ${row.dose}. Duration: ${row.duration}.` });
    }
  }
  return evidence;
}

/** Remove only passages the final checks could not support, retaining reviewed sections. */
export function omitNarrativeFields(value: unknown, fields: ReadonlySet<string>): CompleteReportNarrative | null {
  const parsed = narrativeSchema.safeParse(value);
  if (!parsed.success) return null;
  const complete = completeNarrative(parsed.data);
  return Object.fromEntries(narrativeFieldNames.map(field => [field,
    fields.has(field) ? { text: "", evidenceIds: [] } : complete[field]])) as CompleteReportNarrative;
}

function copiesGuidance(text: string, sources: string[]): boolean {
  const words = (value: string) => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const passage = words(text);
  if (passage.length < 8) return false;
  return sources.some(source => {
    const sourceWords = words(source);
    const sourceText = sourceWords.join(" ");
    const passageText = passage.join(" ");
    // A complete short rule or a sustained passage is copying. A short
    // clinical phrase shared with a longer rule can still be the clearest wording.
    if (sourceWords.length >= 8 && sourceWords.length <= passage.length + 2 && passageText.includes(sourceText)) return true;
    const span = 25;
    for (let index = 0; index <= passage.length - span; index++)
      if (sourceText.includes(passage.slice(index, index + span).join(" "))) return true;
    return false;
  });
}

const headingKey = (text: string) => text.toLocaleLowerCase().replace(/^thyroid (?:issues|disorder)$/, "thyroid");

/** Local checks do not replace clinical review, but reject malformed and ungrounded numerals. */
export function validateNarrative(value: unknown, evidence: ReportEvidence[]): { narrative: CompleteReportNarrative | null; issues: string[] } {
  const parsed = narrativeSchema.safeParse(value);
  if (!parsed.success) return { narrative: null, issues: [
    "INVALID_NARRATIVE_SCHEMA",
    // Keep only the field and validation code. The model's medical prose must
    // not enter operational diagnostics, but a field path makes repair possible.
    ...parsed.error.issues.slice(0, 5).map(issue =>
      `INVALID_NARRATIVE_SCHEMA:${issue.path.join(".") || "root"}:${issue.code}`),
  ] };
  const data = completeNarrative(parsed.data);
  const evidenceById = new Map(evidence.map(item => [item.id, item.text]));
  const requiredGuidance: Partial<Record<keyof ReportNarrative, readonly string[]>> = {
    nutritionAdvice: ["rule:nutrition:"],
    treatmentAdvice: ["rule:status:", "rule:treatment:", "rule:class:", "rule:exception:"],
    conditionAdvice: ["rule:comorbidity:"],
    effectsAdvice: ["rule:toxicity:", "possible:toxicity:", "rule:status:", "rule:treatment:"],
  };
  const issues: string[] = [];
  const sentences = (text: string) => text.replace(/\*\*/g, "").split(/\n|(?<=[.!?])\s+/u)
    .map(line => line.trim().toLocaleLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " "))
    .filter(line => line.split(" ").length >= 6);
  for (const shared of ["redFlagsAdvice", "foodSafetyAdvice"] as const) {
    const sharedSentences = new Set(sentences(data[shared].text));
    if (!sharedSentences.size) continue;
    for (const field of narrativeFieldNames.filter(name => name !== shared)) {
      if (sentences(data[field].text).some(sentence => sharedSentences.has(sentence)))
        issues.push(`${field}:DUPLICATE_${shared === "redFlagsAdvice" ? "RED_FLAG" : "FOOD_SAFETY"}`);
    }
  }
  if (evidenceById.has("fact:niq_risk") && !data.overallSummary.text)
    issues.push("overallSummary:MISSING_SUMMARY");
  if (/\b(?:check|monitor|measure|record|track|test|retest|repeat)\w*\b.{0,100}\b(?:TSH|thyroid[- ]stimulating hormone|blood glucose|glucose level|blood pressure|blood count|lab(?:oratory)? result|weight)\b/i.test(data.conditionAdvice.text))
    issues.push("conditionAdvice:MONITORING_BELONGS_IN_SUMMARY");
  // Matched guidance must not disappear merely because the model returned an
  // empty field and the reviewer accepted it.
  for (const [field, prefixes] of [
    ["nutritionAdvice", ["rule:nutrition:"]],
    ["treatmentAdvice", ["rule:status:", "rule:treatment:", "rule:class:", "rule:exception:"]],
    ["conditionAdvice", ["rule:comorbidity:"]],
    ["effectsAdvice", ["rule:toxicity:"]],
  ] as const) {
    const required = evidence.filter(item => prefixes.some(prefix => item.id.startsWith(prefix)));
    const citedIds = new Set(narrativeFieldNames.flatMap(name => data[name].evidenceIds));
    if (required.some(item => !citedIds.has(item.id))) issues.push(`${field}:MISSING_MATCHED_COVERAGE`);
  }
  if (hasMatchedKidneyCondition(evidence)) {
    for (const field of ["nutritionAdvice", "treatmentAdvice"] as const) {
      const sentences = data[field].text.split(/(?<=[.!?])\s+/u);
      if (sentences.some(sentence => /\b\d+(?:[.\u2013\u2014-]\d+)?\s*(?:kcal\/kg(?:\/day)?|g(?:\s+protein)?\/kg(?:\/day)?)\b/i.test(sentence)))
        issues.push(`${field}:RENAL_FIXED_TARGET_NEEDS_TEAM`);
      if (sentences.some(sentence =>
        /\b(?:aim for|consume|drink|keep fluids up|increase fluids?)\b/i.test(sentence) && /\b(?:\d+(?:\.\d+)?|fluids?)\b/i.test(sentence) ||
        /\btarget\b/i.test(sentence) && /\d/u.test(sentence) &&
          !/\b(?:individuali[sz]|as advised|care team|clinician|doctor)\b/i.test(sentence)))
        issues.push(`${field}:RENAL_TARGET_NEEDS_QUALIFICATION`);
    }
    for (const field of ["nutritionAdvice", "treatmentAdvice", "conditionAdvice", "effectsAdvice"] as const) {
      const sentences = data[field].text.split(/(?<=[.!?])\s+/u);
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
  if (productNames.length && /\b(?:consider|introduce|ask whether)\b.{0,70}\boral nutrition(?:al)? supplements?\b/i.test(data.nutritionAdvice.text))
    issues.push("nutritionAdvice:REDUNDANT_SUPPLEMENT_PROMPT");
  const containsTabletStop = (text: string) => /\b(?:do not|don.t) stop\b.{0,45}\btablets?\b|\bdo not stop these tablets\b/i.test(text);
  if (containsTabletStop(data.conditionAdvice.text) && containsTabletStop(data.redFlagsAdvice.text))
    issues.push("redFlagsAdvice:DUPLICATE_MEDICATION_ACTION");
  // Exception advice must identify a different product unambiguously.
  for (const item of evidence.filter(row => row.id.startsWith("rule:exception:") && data.treatmentAdvice.evidenceIds.includes(row.id))) {
    const fullName = /\b(?:Recommend|Remove|Limit|Replace|Withhold|Do not recommend)\s+([A-Z][\w-]+(?:\s+[A-Z][\w-]+){1,5})\s+(?:at|from|to|with|until|for)\b/i.exec(item.text)?.[1];
    if (!fullName) continue;
    const shortName = fullName.split(/\s+/u).at(-1)!;
    if (new RegExp(`\\b${shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(data.treatmentAdvice.text)
      && !data.treatmentAdvice.text.toLocaleLowerCase().includes(fullName.toLocaleLowerCase())
      && /\b(?:not recommended|avoid|remove|withhold|limit)\b/i.test(data.treatmentAdvice.text))
      issues.push("treatmentAdvice:SHORTENED_EXCEPTION_PRODUCT");
  }
  if (productNames.some(name => name.length > 3 && data.actionSummary.text.split(/[.!?]/u).some(sentence =>
    new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence) &&
    /\b(?:\d+|product|supplement|serving|dose|take|daily|per day)\b/i.test(sentence))))
    issues.push("actionSummary:REPEATS_PRODUCT_PLAN");
  // The closing page should make sense on its own and cannot point to content
  // elsewhere in the report. Such references are especially confusing in a PDF.
  if (/\b(?:above|below|aforementioned|listed)\b/i.test(data.overallSummary.text))
    issues.push("overallSummary:POSITIONAL_REFERENCE");
  for (const [field, part] of Object.entries(data)) {
    const lines = part.text.split("\n");
    for (const markedLine of lines) {
      const line = markedLine.replace(/\*\*([^*\n]+)\*\*/g, "$1");
      if (/^\s*#{1,6}\s/u.test(line)) {
        const heading = /^### ([\p{L}\p{N}][\p{L}\p{N} &'(),/-]*)$/u.exec(line)?.[1];
        const supportedLabels = evidence.filter(item => item.id.startsWith("rule:comorbidity:")
          && part.evidenceIds.includes(item.id)).map(item => item.text.split(":", 1)[0]!.trim());
        if (field !== "conditionAdvice" || !heading || !supportedLabels.some(label => headingKey(label) === headingKey(heading)))
          issues.push(`${field}:UNSUPPORTED_HEADING`);
      }
      if (/^\s*(?:[-*+]\s|\d+[.)]\s|>+\s|---+$)|\*|__|~~|`|\[[^\]]+\]\(/u.test(line))
        issues.push(`${field}:MARKDOWN_STYLE`);
    }
    if (field === "conditionAdvice" && part.text) {
      const citedLabels = evidence.filter(item => item.id.startsWith("rule:comorbidity:")
        && part.evidenceIds.includes(item.id)).map(item => item.text.split(":", 1)[0]!.trim());
      const headings = lines.flatMap(line => {
        const match = /^### (.+)$/u.exec(line);
        return match ? [match[1]!] : [];
      });
      if (citedLabels.some(label => !headings.some(heading => headingKey(heading) === headingKey(label))))
        issues.push("conditionAdvice:MISSING_CONDITION_HEADING");
    }
    if (/\bask\b.{0,70}\b(?:oral nutrition(?:al)? supplements?|(?:DM|diabet(?:es|ic)) supplements?|supplement (?:suitability|compatibility))\b/i.test(part.text))
      issues.push(`${field}:REDUNDANT_SUPPLEMENT_PROMPT`);
    if (/\b(?:Es Fortitude )?Nourish\b.{0,70}\b(?:cannot|can't|not|avoid|exclude|remove)\b|\b(?:cannot recommend|do not recommend|avoid|exclude|remove)\b.{0,70}\b(?:Es Fortitude )?Nourish\b/i.test(part.text))
      issues.push(`${field}:INTERNAL_PRODUCT_EXCLUSION`);
    const selected = part.evidenceIds.map(id => evidenceById.get(id));
    if (selected.some(text => text === undefined)) issues.push(`${field}:UNKNOWN_EVIDENCE_ID`);
    if (part.evidenceIds.some(id => id.startsWith("possible:toxicity:") &&
      evidenceById.get(id)?.includes("Named-drug confirmation is required")))
      issues.push(`${field}:DRUG_SPECIFIC_CANDIDATE_UNVERIFIED`);
    if (field === "effectsAdvice" && part.evidenceIds.some(id => id.startsWith("possible:toxicity:"))
      && !part.evidenceIds.some(id => id.startsWith("fact:assessment_") || id.startsWith("fact:clinician_toxicity_")))
      issues.push(`${field}:CANDIDATE_NEEDS_REPORTED_EFFECT`);
    if (field === "effectsAdvice" && part.evidenceIds.some(id => id.startsWith("rule:status:"))
      && !part.evidenceIds.some(id => id.startsWith("fact:assessment_") || id.startsWith("fact:clinician_toxicity_")))
      issues.push(`${field}:STATUS_GUIDANCE_NEEDS_REPORTED_EFFECT`);
    if (field === "effectsAdvice" && part.evidenceIds.some(id => id.startsWith("rule:treatment:"))
      && !part.evidenceIds.some(id => id.startsWith("fact:assessment_") || id.startsWith("fact:clinician_toxicity_")))
      issues.push(`${field}:TREATMENT_GUIDANCE_NEEDS_REPORTED_EFFECT`);
    const prefixes = requiredGuidance[field as keyof ReportNarrative];
    if (part.text && prefixes && !part.evidenceIds.some(id => prefixes.some(prefix => id.startsWith(prefix))))
      issues.push(`${field}:MISSING_MATCHED_GUIDANCE`);
    if (part.text && prefixes && copiesGuidance(part.text, part.evidenceIds.filter(id => id.startsWith("rule:") || id.startsWith("possible:"))
      .map(id => evidenceById.get(id)).filter((source): source is string => Boolean(source))))
      issues.push(`${field}:COPIED_GUIDANCE`);
    const sourceNumbers = new Set(selected.flatMap(text => text?.match(/\d+(?:\.\d+)?/g) ?? []));
    if ((part.text.match(/\d+(?:\.\d+)?/g) ?? []).some(number => !sourceNumbers.has(number))) issues.push(`${field}:UNSUPPORTED_NUMBER`);
    if (/\b(?:hba1c|h1bac|hb\s*a1c|a1c|glycated\s+ha?emoglobin)\b/i.test(part.text)) issues.push(`${field}:EXCLUDED_REPORT_TERM`);
    if (/\b75%\s+of\s+(?:your\s+)?(?:usual|previous|normal)\s+(?:oral\s+)?intake\b/i.test(part.text)) issues.push(`${field}:INTAKE_DENOMINATOR_UNCLEAR`);
    if (/\b2\.3\s*g\b.{0,100}\b5\s*g\s+(?:of\s+)?salt\b|\b5\s*g\s+(?:of\s+)?salt\b.{0,100}\b2\.3\s*g\b/i.test(part.text))
      issues.push(`${field}:SODIUM_SALT_EQUIVALENCE_MISMATCH`);
    if (/\b(?:diagnosed with|has developed|is experiencing)\b/i.test(part.text) && part.evidenceIds.some(id => id.startsWith("possible:"))) issues.push(`${field}:POSSIBLE_EFFECT_AS_CONFIRMED`);
    if (evidenceById.has("fact:planned_treatment_start") && /\b(?:receiving|undergoing|currently on)\s+(?:chemotherapy|radiation|radiotherapy|immunotherapy|targeted therapy|hormonal therapy|treatment)\b/i.test(part.text))
      issues.push(`${field}:PLANNED_TREATMENT_AS_CURRENT`);
    if (/[;—\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(part.text)) issues.push(`${field}:REPORT_STYLE`);
  }
  return { narrative: issues.length ? null : data, issues };
}
