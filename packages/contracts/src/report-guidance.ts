import type { FinalAssessmentAnswers, FinalAssessmentDefinition } from "./final-assessment";
import workbookDefaults from "./report-guidance-defaults.json" with { type: "json" };

type Guidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;
type PossibleToxicity = Pick<Guidance["toxicity"][number], "id" | "classId" | "treatmentTypeId" | "expectedToxicity" | "nutritionalInterventions" | "requiresDrugConfirmation" | "source">;
const importedRows = new Map((workbookDefaults.toxicity as Guidance["toxicity"]).map(row => [row.id, row]));

/** Check only selected questionnaire answers; a clinical-confirmation rule never matches here. */
export function matchesToxicityAssessmentAnswers(match: Guidance["toxicity"][number]["match"], answers: FinalAssessmentAnswers): boolean {
  if (match?.mode === "weight_change") {
    const previous = answers.previous_weight_kg;
    const current = answers.current_weight_kg;
    if (typeof previous !== "number" || typeof current !== "number" || !Number.isFinite(previous) || !Number.isFinite(current) || previous <= 0 || current <= 0) return false;
    return match.direction === "gain" ? current > previous : current < previous;
  }
  if (!match || match.mode !== "assessment_answer") return false;
  const selected = ({ fieldId, optionId }: (typeof match.anyOf)[number]) => {
    const value = answers[fieldId];
    return typeof value === "string" ? value === optionId : Array.isArray(value) && value.includes(optionId);
  };
  return match.operator === "all" ? match.anyOf.every(selected) : match.anyOf.some(selected);
}

/** Show the already-reviewed class wording as the one editable rule for legacy rows. */
export function classOnlyToxicity(rule: Guidance["toxicity"][number]): Guidance["toxicity"][number] {
  if (!rule.requiresDrugConfirmation) return rule;
  // Some earlier drafts saved the imported source row without its report-only
  // alternative. Recover that alternative only when the source row is unchanged.
  const imported = importedRows.get(rule.id);
  const unchangedImport = imported && imported.classId === rule.classId && imported.treatmentTypeId === rule.treatmentTypeId
    && imported.expectedToxicity === rule.expectedToxicity && imported.nutritionalInterventions === rule.nutritionalInterventions;
  const toxicity = rule.classLevelToxicity || (unchangedImport ? imported.classLevelToxicity : undefined);
  const interventions = rule.classLevelInterventions || (unchangedImport ? imported.classLevelInterventions : undefined);
  if (!toxicity || !interventions) return rule;
  const { classLevelToxicity, classLevelInterventions, ...rest } = rule;
  return {
    ...rest,
    expectedToxicity: toxicity,
    nutritionalInterventions: interventions,
    requiresDrugConfirmation: false,
  };
}

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
  /** Class-level reference rows with conditional guidance, never assertions about the patient. */
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
  const classMatches = guidance.toxicity.filter(rule => rule.enabled
    && selectedClasses.has(rule.classId)
    && treatments.has(rule.treatmentTypeId));
  // Every class/treatment row is a candidate. Drug-specific source wording is
  // retained as conditional reference only when no class-level alternative exists.
  const candidates = classMatches.map(classOnlyToxicity);
  const possibleToxicities = candidates.map(({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions, requiresDrugConfirmation, source }) =>
    ({ id, classId, treatmentTypeId, expectedToxicity, nutritionalInterventions, requiresDrugConfirmation, source }));
  const toxicity = candidates.filter(rule => confirmed.has(rule.id) && !rule.requiresDrugConfirmation);
  return { nutrition, classGuidance, possibleToxicities, toxicity };
}
