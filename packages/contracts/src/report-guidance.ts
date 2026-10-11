import type { FinalAssessmentDefinition } from "./final-assessment";

type Guidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;

export type ReportGuidanceFacts = {
  riskCategoryId: string | null;
  treatmentTypeIds: string[];
  drugClassIds: string[];
  /** Explicitly observed or clinician-confirmed toxicity row IDs; possible effects alone do not qualify. */
  confirmedToxicityIds: string[];
  /** Separate confirmation that the named drug in a row was actually prescribed. */
  confirmedDrugSpecificRuleIds: string[];
};

/** Match saved report rules to confirmed facts without interpreting free text. */
export function resolveReportGuidance(definition: FinalAssessmentDefinition, facts: ReportGuidanceFacts): {
  nutrition: Guidance["nutrition"];
  /** Class-level reference rows: possible effects, never assertions about the patient. */
  possibleToxicities: Guidance["toxicity"];
  toxicity: Guidance["toxicity"];
} {
  const guidance = definition.reportGuidance;
  if (!guidance) return { nutrition: [], possibleToxicities: [], toxicity: [] };
  const nutrition = guidance.nutrition.filter(rule => rule.enabled && (rule.riskCategoryId === null || rule.riskCategoryId === facts.riskCategoryId));
  // Other is exclusive and only receives the generic nutrition tier.
  if (facts.drugClassIds.includes("other")) return { nutrition, possibleToxicities: [], toxicity: [] };
  const classes = new Set(facts.drugClassIds);
  const treatments = new Set(facts.treatmentTypeIds);
  const confirmed = new Set(facts.confirmedToxicityIds);
  const drugsConfirmed = new Set(facts.confirmedDrugSpecificRuleIds);
  const possibleToxicities = guidance.toxicity.filter(rule => rule.enabled
    && classes.has(rule.classId)
    && treatments.has(rule.treatmentTypeId)
    && (!rule.requiresDrugConfirmation || drugsConfirmed.has(rule.id)));
  const toxicity = possibleToxicities.filter(rule => confirmed.has(rule.id));
  return { nutrition, possibleToxicities, toxicity };
}
