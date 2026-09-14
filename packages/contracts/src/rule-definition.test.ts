import { expect, test } from "bun:test";
import { blankRuleDefinition, questionSchema, ruleDefinitionSchema } from "./rule-definition";
import { validateRuleDefinition } from "./rule-validation";

function fixture() {
  const d = blankRuleDefinition("Synthetic test");
  d.sections = [{ id: "section", title: "Test", description: "", questions: [questionSchema.parse({ id: "value", label: "Value", type: "number", purpose: "scoring", required: true, validation: { min: 0, max: 10 } })] }];
  d.domains = [{ id: "domain", label: "Test", cap: null, sources: [] }];
  d.scoring = [{ id: "points", kind: "ranges", label: "Points", domainId: "domain", sources: [], input: { kind: "question", id: "value" }, bands: [{ id: "range", min: 0, max: 10, minInclusive: true, maxInclusive: true, points: 1 }] }];
  d.classifications = [{ id: "category", label: "Test", interpretation: "Synthetic", sources: [], min: null, max: null, minInclusive: true, maxInclusive: true }];
  return d;
}
test("definition rejects executable or unsupported data and nonfinite constants", () => {
  expect(ruleDefinitionSchema.safeParse({ ...fixture(), script: "return 1" }).success).toBe(false);
  const d = fixture();
  d.calculations.push({ id: "calc", label: "Calc", unit: "", operation: "sum", operands: [{ kind: "constant", value: Infinity }], precision: 2, sources: [] });
  expect(ruleDefinitionSchema.safeParse(d).success).toBe(false);
});
test("complete synthetic structure passes, unfinished drafts remain distinguishable", () => {
  expect(validateRuleDefinition(ruleDefinitionSchema.parse(fixture()))).toEqual([]);
  expect(validateRuleDefinition(blankRuleDefinition("Draft")).every(i => i.severity === "blocking")).toBe(true);
});
test("duplicate identifiers and broken references are integrity errors", () => {
  const d = fixture(); d.sections[0]!.questions.push({ ...d.sections[0]!.questions[0]! });
  d.scoring[0]!.domainId = "missing";
  expect(validateRuleDefinition(d).map(i => i.code)).toContain("DUPLICATE_ID");
  expect(validateRuleDefinition(d).map(i => i.code)).toContain("MISSING_DOMAIN");
});
test("visibility and calculation cycles are rejected", () => {
  const d = fixture();
  d.sections[0]!.questions[0]!.visibleWhen = { match: "all", tests: [{ ref: { kind: "question", id: "value" }, operator: "answered" }] };
  d.calculations = [{ id: "calc", label: "Cycle", operation: "sum", operands: [{ kind: "calculation", id: "calc" }], precision: 0, unit: "", sources: [] }];
  expect(validateRuleDefinition(d).filter(i => i.code === "CYCLE")).toHaveLength(2);
});
test("numeric rule ranges identify uncovered inputs and shared boundaries", () => {
  const d = fixture(); const rule = d.scoring[0]!;
  if (rule.kind !== "ranges") throw new Error("fixture");
  rule.bands[0]!.max = 5;
  expect(validateRuleDefinition(d).map(i => i.code)).toContain("RANGE_COVERAGE");
  rule.bands.push({ id: "second", min: 5, max: 10, minInclusive: true, maxInclusive: true, points: 2 });
  expect(validateRuleDefinition(d).map(i => i.code)).toContain("OVERLAPPING_RANGES");
  rule.bands[0]!.maxInclusive = false;
  expect(validateRuleDefinition(d)).toEqual([]);
});
test("type changes cannot leave incompatible scoring and comparison references", () => {
  const d = fixture(); d.sections[0]!.questions[0]!.type = "text";
  expect(validateRuleDefinition(d).map(i => i.code)).toContain("NUMERIC_INPUT");
  expect(validateRuleDefinition(d).map(i => i.code)).toContain("VALIDATION_TYPE");
});
test("resolved issues require a recorded resolution", () => {
  const d = fixture(); d.issues = [{ id: "issue", path: "scoring", message: "Needs review", resolved: true, blocking: true, resolution: "", sources: [] }];
  expect(validateRuleDefinition(d).map(i => i.code)).toContain("MISSING_RESOLUTION");
});

test("classifications cover both score endpoints after caps and rounding", () => {
  const d = fixture(); const rule = d.scoring[0]!;
  if (rule.kind !== "ranges") throw new Error("fixture");
  rule.bands = [
    { id: "low", min: 0, max: 5, minInclusive: true, maxInclusive: false, points: -1.234 },
    { id: "high", min: 5, max: 10, minInclusive: true, maxInclusive: true, points: 9 },
  ];
  d.domains[0]!.cap = 8; d.total.cap = 7; d.total.precision = 2;
  d.classifications[0]!.min = -1.23; d.classifications[0]!.max = 7;
  expect(validateRuleDefinition(d)).toEqual([]);
  d.classifications[0]!.minInclusive = false;
  expect(validateRuleDefinition(d).map(i => i.code)).toContain("CLASSIFICATION_COVERAGE");
  d.classifications[0]!.minInclusive = true;
  d.classifications[0]!.max = 6.99;
  expect(validateRuleDefinition(d).map(i => i.code)).toContain("CLASSIFICATION_COVERAGE");
});
