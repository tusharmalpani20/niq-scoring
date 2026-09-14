import type { RuleAnswers, RuleDefinition } from "@niq-scoring/contracts/rules";
import { newRuleId } from "./questionnaire-model";
export type RuleSample = RuleDefinition["samples"][number];
// Expectations deliberately start empty: actual evaluator output is never copied into them.
export function newSample(answers: RuleAnswers = {}): RuleSample {
  return { id: newRuleId("sample"), name: "New sample", answers: structuredClone(answers), expected: { complete: false, score: null, classificationId: null, interventionIds: [], domains: {}, calculations: {} } };
}
export function setExpectedNumber(values: Record<string, number>, id: string, input: string) {
  const next = { ...values };
  if (input === "") delete next[id]; else next[id] = Number(input);
  return next;
}
