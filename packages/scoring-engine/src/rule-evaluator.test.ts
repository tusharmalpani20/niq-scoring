import { expect, test } from "bun:test";
import { blankRuleDefinition, questionSchema, type RuleDefinition } from "@niq-scoring/contracts/rules";
import { evaluateRule, validateSamples } from "./rule-evaluator";
import { evaluateCondition } from "./rule-answers";
function fixture(): RuleDefinition {
  const d = blankRuleDefinition("Synthetic only");
  d.sections = [{ id: "body", title: "Body", description: "", questions: [questionSchema.parse({ id: "weight", label: "Weight", type: "number", purpose: "scoring", required: true, validation: { min: 0, max: 100 } })] }];
  d.domains = [{ id: "test_domain", label: "Synthetic", cap: 8, sources: [] }];
  d.scoring = [{ id: "score_weight", label: "Test points", domainId: "test_domain", kind: "ranges", input: { kind: "question", id: "weight" }, sources: [], bands: [{ id: "under", min: 0, max: 50, minInclusive: true, maxInclusive: false, points: 2 }, { id: "over", min: 50, max: 100, minInclusive: true, maxInclusive: true, points: 10 }] }];
  d.classifications = [{ id: "low", label: "Low (synthetic)", interpretation: "Test", min: null, max: 5, minInclusive: true, maxInclusive: false, sources: [] }, { id: "high", label: "High (synthetic)", interpretation: "Test", min: 5, max: null, minInclusive: true, maxInclusive: true, sources: [] }];
  return d;
}
test("ranges use explicit boundaries and domain caps, preserving zero answers", () => {
  const d = fixture();
  expect(evaluateRule(d, { weight: 0 }).score).toBe(2);
  expect(evaluateRule(d, { weight: 49.99 }).classification?.id).toBe("low");
  const high = evaluateRule(d, { weight: 50 });
  expect(high.complete).toBe(true); expect(high.components[0]?.points).toBe(10); expect(high.domains.test_domain).toBe(8); expect(high.score).toBe(8);
});
test("missing and invalid inputs do not become low-risk results", () => {
  for (const answers of [{}, { weight: null }, { weight: "50" }, { weight: -1 }, { weight: 101 }, { weight: 30, unknown: 1 }]) {
    const result = evaluateRule(fixture(), answers); expect(result.complete).toBe(false); expect(result.score).toBeNull(); expect(result.classification).toBeNull();
  }
});
test("missing values do not match inequality, false and zero are answered", () => {
  const condition = { match: "all" as const, tests: [{ ref: { kind: "question" as const, id: "test" }, operator: "neq" as const, value: 1 }] };
  expect(evaluateCondition(condition, () => undefined)).toBeNull();
  expect(evaluateCondition(condition, () => 0)).toBe(true);
  expect(evaluateCondition({ match: "all", tests: [{ ref: { kind: "question", id: "test" }, operator: "answered" }] }, () => false)).toBe(true);
});
test("hidden answers are ignored and dependent scoring remains incomplete", () => {
  const d = fixture(); d.sections[0]!.questions.push(questionSchema.parse({ id: "show", label: "Show", type: "boolean", purpose: "assessment", required: true }));
  d.sections[0]!.questions[0]!.visibleWhen = { match: "all", tests: [{ ref: { kind: "question", id: "show" }, operator: "eq", value: true }] };
  const hidden = evaluateRule(d, { show: false, weight: 50 }); expect(hidden.visible.weight).toBe(false); expect(hidden.score).toBeNull();
  expect(evaluateRule(d, { show: true, weight: 50 }).score).toBe(8);
});
test("BMI and percentage change round defined calculations, zero division is unavailable", () => {
  const d = fixture();
  d.calculations = [{ id: "bmi", label: "BMI", operation: "bmi", operands: [{ kind: "question", id: "weight" }, { kind: "constant", value: 170 }], precision: 2, unit: "", sources: [] }, { id: "loss", label: "Loss", operation: "percentage_change", operands: [{ kind: "constant", value: 80 }, { kind: "question", id: "weight" }], precision: 1, unit: "%", sources: [] }];
  const result = evaluateRule(d, { weight: 70 }); expect(result.calculations.bmi).toBe(24.22); expect(result.calculations.loss).toBe(12.5);
  d.calculations[0]!.operands[1] = { kind: "constant", value: 0 };
  expect(evaluateRule(d, { weight: 70 }).score).toBeNull();
});
test("multi-select aggregation rejects invalid and duplicate options", () => {
  const d = fixture(); d.sections[0]!.questions = [questionSchema.parse({ id: "symptoms", label: "Synthetic", type: "multi_select", purpose: "scoring", required: true, options: [{ id: "symptom_a", label: "A" }, { id: "symptom_b", label: "B" }] })];
  d.scoring = [{ id: "score_symptoms", label: "Test", domainId: "test_domain", kind: "options", questionId: "symptoms", aggregation: "sum", cap: 5, points: [{ optionId: "symptom_a", points: 2 }, { optionId: "symptom_b", points: 4 }], sources: [] }];
  expect(evaluateRule(d, { symptoms: ["symptom_a", "symptom_b"] }).score).toBe(5);
  expect(evaluateRule(d, { symptoms: ["symptom_a", "symptom_a"] }).complete).toBe(false);
  expect(evaluateRule(d, { symptoms: ["old_option"] }).complete).toBe(false);
});
test("guidance priority, exclusions and duplicate text are deterministic", () => {
  const d = fixture();
  const base = { kind: "note" as const, label: "Synthetic", text: "Test output", when: { match: "all" as const, tests: [{ ref: { kind: "classification" as const, id: "classification" }, operator: "eq" as const, value: "high" }] }, sources: [] };
  d.interventions = [{ ...base, id: "lower", priority: 1, exclusiveGroup: "test_group" }, { ...base, id: "higher", priority: 2, exclusiveGroup: "test_group" }, { ...base, id: "duplicate", priority: 0, exclusiveGroup: null }];
  expect(evaluateRule(d, { weight: 70 }).interventions.map(i => i.id)).toEqual(["higher"]);
});
test("selected exclusive guidance does not require answers for lower-priority alternatives", () => {
  const d = fixture();
  d.sections[0]!.questions.push(questionSchema.parse({
    id: "follow_up", label: "Synthetic follow-up", type: "boolean", purpose: "assessment", required: false,
  }));
  d.interventions = [
    {
      id: "fallback", label: "Fallback", kind: "note", text: "Synthetic alternative", priority: 1,
      exclusiveGroup: "guidance", sources: [],
      when: { match: "all", tests: [{ ref: { kind: "question", id: "follow_up" }, operator: "eq", value: true }] },
    },
    {
      id: "preferred", label: "Preferred", kind: "note", text: "Synthetic preferred output", priority: 2,
      exclusiveGroup: "guidance", sources: [],
      when: { match: "all", tests: [{ ref: { kind: "classification", id: "classification" }, operator: "eq", value: "high" }] },
    },
  ];

  // Definition order does not override priority. Missing optional answers for a
  // ruled-out alternative must not invalidate the selected recommendation.
  const selected = evaluateRule(d, { weight: 70 });
  expect(selected.complete).toBe(true);
  expect(selected.interventions.map(item => item.id)).toEqual(["preferred"]);
  expect(selected.issues).toEqual([]);

  // When the preferred outcome does not match, the fallback still needs its answer.
  const unansweredFallback = evaluateRule(d, { weight: 20 });
  expect(unansweredFallback.complete).toBe(false);
  expect(unansweredFallback.issues.map(issue => issue.code)).toContain("INCOMPLETE_INTERVENTION");
  expect(evaluateRule(d, { weight: 20, follow_up: true }).interventions.map(item => item.id)).toEqual(["fallback"]);

  // Independent guidance cannot be skipped simply because another item matched.
  d.interventions[0]!.exclusiveGroup = null;
  expect(evaluateRule(d, { weight: 70 }).complete).toBe(false);

  // Nor may an unknown higher-priority outcome be bypassed by a matching lower one.
  d.interventions[0]!.exclusiveGroup = "guidance";
  d.interventions[0]!.priority = 3;
  const unresolvedWinner = evaluateRule(d, { weight: 70 });
  expect(unresolvedWinner.complete).toBe(false);
  expect(unresolvedWinner.interventions).toEqual([]);
});
test("unresolved source instructions suppress final scores while retaining partial evidence", () => {
  const d = fixture(); d.issues = [{ id: "unresolved", path: "scoring", message: "Clinical decision missing", blocking: true, resolved: false, resolution: "", sources: [] }];
  const result = evaluateRule(d, { weight: 30 }); expect(result.score).toBeNull(); expect(result.components[0]?.points).toBe(2); expect(result.complete).toBe(false);
});
test("sample expected outputs are independently checked", () => {
  const d = fixture(); d.samples = [{ id: "test_case", name: "Boundary", answers: { weight: 50 }, expected: { complete: true, score: 8, classificationId: "high", interventionIds: [], domains: { test_domain: 8 }, calculations: {} } }];
  expect(validateSamples(d)).toEqual([]);
  d.samples[0]!.expected.score = 7;
  expect(validateSamples(d)[0]?.path).toBe("samples.test_case.score");
  expect(validateSamples(d)[0]?.message).toContain("expected 7, received 8");
});
