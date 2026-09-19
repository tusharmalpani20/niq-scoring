import { isFinalAssessmentDefinition, type VersionedRuleDefinition } from "@niq-scoring/contracts/versioned-definition";
import type { RuleAnswers } from "@niq-scoring/contracts/rules";
import { evaluateRule, type RuleEvaluation } from "./rule-evaluator";
import { evaluateFinalAssessment, type FinalAssessmentEvaluation } from "./final-assessment-evaluator";

export type VersionedEvaluation = RuleEvaluation | FinalAssessmentEvaluation;

export function evaluateVersionedRule(definition: VersionedRuleDefinition, answers: RuleAnswers): VersionedEvaluation {
  return isFinalAssessmentDefinition(definition) ? evaluateFinalAssessment(definition, answers) : evaluateRule(definition, answers);
}
