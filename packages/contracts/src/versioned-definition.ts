import { z } from "zod";
import { ruleDefinitionSchema, type RuleDefinition } from "./rule-definition";
import { finalAssessmentDefinitionSchema, type FinalAssessmentDefinition } from "./final-assessment";

export const versionedRuleDefinitionSchema = z.discriminatedUnion("formatVersion", [ruleDefinitionSchema, finalAssessmentDefinitionSchema]);
export type VersionedRuleDefinition = RuleDefinition | FinalAssessmentDefinition;

export function isFinalAssessmentDefinition(value: unknown): value is FinalAssessmentDefinition {
  return finalAssessmentDefinitionSchema.safeParse(value).success;
}
