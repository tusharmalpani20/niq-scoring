import { finalAssessmentDefinitionSchema } from "@niq-scoring/contracts/final-assessment";
import { initialCarePlanGuidance } from "@niq-scoring/contracts/care-plan-guidance";
import { withDefaultRiskCategoryColors } from "@niq-scoring/contracts/final-assessment-template";
import { normalizeProductPlan } from "@niq-scoring/contracts/product-guidance";
import { initialReportAiConfig } from "@niq-scoring/contracts/report-ai";
import { DEFAULT_STRESS_SCORING_CONFIG } from "@niq-scoring/contracts/stress-scoring";
import type { RuleDetail } from "./rule-api";

function parse(value: unknown) {
  const result = finalAssessmentDefinitionSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function editableDefinition(record: RuleDetail) {
  const definition = parse(record.definition);
  if (!definition || !["DRAFT", "VALIDATED"].includes(record.lifecycle)) return definition;
  const carePlanGuidance = definition.carePlanGuidance ?? initialCarePlanGuidance();
  return withDefaultRiskCategoryColors({ ...definition, stressScoring: definition.stressScoring ?? structuredClone(DEFAULT_STRESS_SCORING_CONFIG),
    carePlanGuidance: { ...carePlanGuidance, products: { ...carePlanGuidance.products,
      plans: carePlanGuidance.products.plans.map(normalizeProductPlan) } }, reportAi: definition.reportAi ?? initialReportAiConfig() });
}

// JSON key order is not a rule edit. Arrays remain ordered because rule order matters.
export function comparableDefinition(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item) ?? "undefined";
}

export function draftUpdateRequired(record: RuleDetail): boolean {
  const saved = parse(record.definition);
  const editable = editableDefinition(record);
  return saved !== null && editable !== null && comparableDefinition(editable) !== comparableDefinition(saved);
}
