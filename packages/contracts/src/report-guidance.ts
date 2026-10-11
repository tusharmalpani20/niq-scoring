import type { FinalAssessmentDefinition } from "./final-assessment";

type Guidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;
type PossibleToxicity = Pick<Guidance["toxicity"][number], "id" | "classId" | "treatmentTypeId" | "expectedToxicity" | "requiresDrugConfirmation" | "source">;

export type ReportGuidanceFacts = {
  riskCategoryId: string | null;
  treatmentTypeIds: string[];
  drugClassIds: string[];
  /** Explicitly observed or clinician-confirmed toxicity row IDs; possible effects alone do not qualify. */
  confirmedToxicityIds: string[];
};

/** Match saved report rules to confirmed facts without interpreting free text. */
export function resolveReportGuidance(definition: FinalAssessmentDefinition, facts: ReportGuidanceFacts): {
  nutrition: Guidance["nutrition"];
  classGuidance: Array<{ id: string; label: string; guidance: string }>;
  /** Class-level reference rows: possible effects, never assertions about the patient. */
  possibleToxicities: PossibleToxicity[];
  toxicity: Guidance["toxicity"];
} {
  const selectedClasses = new Set(facts.drugClassIds);
  const classGuidance = facts.drugClassIds.includes("other") ? [] : (definition.drugClassConfig?.classes ?? [])
    .filter(item => selectedClasses.has(item.id) && item.guidance?.trim())
    .map(item => ({ id: item.id, label: item.label, guidance: item.guidance!.trim() }));
  const guidance = definition.reportGuidance;
  if (!guidance) return { nutrition: [], classGuidance, possibleToxicities: [], toxicity: [] };
  const nutrition = guidance.nutrition.filter(rule => rule.enabled && (rule.riskCategoryId === null || rule.riskCategoryId === facts.riskCategoryId));
  // Other is exclusive and only receives the generic nutrition tier.
  if (facts.drugClassIds.includes("other")) return { nutrition, classGuidance: [], possibleToxicities: [], toxicity: [] };
  const treatments = new Set(facts.treatmentTypeIds);
  const confirmed = new Set(facts.confirmedToxicityIds);
  const eligibleToxicities = guidance.toxicity.filter(rule => rule.enabled
    && selectedClasses.has(rule.classId)
    && treatments.has(rule.treatmentTypeId)
    && (!rule.requiresDrugConfirmation || Boolean(rule.classLevelToxicity && rule.classLevelInterventions)));
  // The assessment captures a class, not an individual drug. Full source wording
  // remains editable in the rule version but must not enter the report packet.
  const safeToxicities = eligibleToxicities.map(rule => rule.requiresDrugConfirmation
    ? { ...rule, expectedToxicity: rule.classLevelToxicity!, nutritionalInterventions: rule.classLevelInterventions! }
    : rule);
  const possibleToxicities = safeToxicities.map(({ id, classId, treatmentTypeId, expectedToxicity, requiresDrugConfirmation, source }) =>
    ({ id, classId, treatmentTypeId, expectedToxicity, requiresDrugConfirmation, source }));
  const toxicity = safeToxicities.filter(rule => confirmed.has(rule.id));
  return { nutrition, classGuidance, possibleToxicities, toxicity };
}
