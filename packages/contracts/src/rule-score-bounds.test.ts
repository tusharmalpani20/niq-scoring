import { expect, test } from "bun:test";
import { blankRuleDefinition, questionSchema } from "./rule-definition";
import { ruleScoreBounds } from "./rule-score-bounds";

function fixture(points: number[], type: "single_select" | "multi_select" = "multi_select") {
  const d = blankRuleDefinition("Synthetic bounds");
  d.sections = [{ id: "section", title: "Test", description: "", questions: [questionSchema.parse({
    id: "choice", label: "Choice", type, required: true, purpose: "scoring", options: points.map((_, i) => ({ id: `option_${i}`, label: String(i) })),
  })] }];
  d.domains = [{ id: "domain", label: "Domain", cap: null, sources: [] }];
  d.scoring = [{ id: "points", kind: "options", label: "Points", domainId: "domain", sources: [], questionId: "choice", aggregation: "sum", cap: null, points: points.map((value, i) => ({ optionId: `option_${i}`, points: value })) }];
  return d;
}

test("selection bounds distinguish nonempty multi-select sums, max and single-select", () => {
  expect(ruleScoreBounds(fixture([2, 3]))).toEqual({ min: 2, max: 5 });
  expect(ruleScoreBounds(fixture([-2, -3]))).toEqual({ min: -5, max: -2 });
  expect(ruleScoreBounds(fixture([-2, 0, 3, 4]))).toEqual({ min: -2, max: 7 });
  expect(ruleScoreBounds(fixture([2, 3], "single_select"))).toEqual({ min: 2, max: 3 });
  const d = fixture([-2, 3, 4]); const rule = d.scoring[0]!;
  if (rule.kind !== "options") throw new Error("fixture");
  rule.aggregation = "max";
  expect(ruleScoreBounds(d)).toEqual({ min: -2, max: 4 });
  rule.cap = 3;
  expect(ruleScoreBounds(d)).toEqual({ min: -2, max: 3 });
});

test("condition outcomes, domain caps, total max and total sum retain their semantics", () => {
  const d = fixture([2, 3]);
  d.domains.push({ id: "other", label: "Other", cap: 6, sources: [] });
  d.scoring.push({ id: "conditional", kind: "condition", domainId: "other", label: "Conditional", sources: [], when: { match: "all", tests: [{ ref: { kind: "question", id: "choice" }, operator: "answered" }] }, points: 8, otherwise: -4 });
  expect(ruleScoreBounds(d)).toEqual({ min: -2, max: 11 });
  d.total.aggregation = "max";
  expect(ruleScoreBounds(d)).toEqual({ min: 2, max: 6 });
  d.total.cap = 4;
  expect(ruleScoreBounds(d)).toEqual({ min: 2, max: 4 });
});
