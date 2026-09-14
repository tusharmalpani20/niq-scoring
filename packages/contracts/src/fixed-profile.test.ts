import { expect, test } from "bun:test";
import { createSpreadsheetTemplate } from "./rule-template";
import { isFixedRuleDefinition } from "./fixed-profile";
import { validateRuleDefinition } from "./rule-validation";

test("fixed profile protects fields, options, conditions, source decisions and calculations", () => {
  const template = createSpreadsheetTemplate("Example");
  expect(isFixedRuleDefinition(template)).toBe(true);
  for (const mutate of [
    (d: typeof template) => { d.sections[0]!.questions[0]!.label = "Changed"; },
    (d: typeof template) => { d.sections.reverse(); },
    (d: typeof template) => { d.sections[0]!.questions.pop(); },
    (d: typeof template) => { d.sections.flatMap(s => s.questions).find(q => q.options.length)!.options[0]!.label = "Changed"; },
    (d: typeof template) => { d.calculations[0]!.precision = 6; },
    (d: typeof template) => { d.issues = []; },
    (d: typeof template) => { d.domains[0]!.label = "Changed"; },
    (d: typeof template) => { d.scoring.pop(); },
  ]) {
    const changed = structuredClone(template); mutate(changed);
    expect(isFixedRuleDefinition(changed)).toBe(false);
  }
});

test("fixed profile permits configured scores, source resolutions and caps", () => {
  const d = createSpreadsheetTemplate("Example");
  d.name = "Configured version";
  d.domains[0]!.cap = 8;
  d.total.cap = 40;
  for (const score of d.scoring) {
    score.domainId = "disease";
    if (score.kind === "options") { score.points.forEach(p => p.points += 1); score.cap = 6; }
    if (score.kind === "condition") score.points = 2;
  }
  d.issues.forEach(i => { i.resolved = true; i.resolution = "Synthetic review only"; });
  expect(isFixedRuleDefinition(d)).toBe(true);
  // Resolving the source note cannot bypass a missing scoring-domain assignment.
  d.scoring[0]!.domainId = "unassigned";
  expect(validateRuleDefinition(d).some(i => i.code === "UNASSIGNED_DOMAIN")).toBe(true);
});

test("fixed numeric fields allow different scoring bands without changing input definitions", () => {
  const d = createSpreadsheetTemplate('Range configuration');
  const rule = d.scoring.find(r => r.kind === 'ranges');
  if (!rule || rule.kind !== 'ranges') throw new Error('Expected a configured numeric field');
  rule.bands = [
    { id: 'custom_lower', min: null, max: 1, minInclusive: false, maxInclusive: false, points: 0 },
    { id: 'custom_middle', min: 1, max: 2, minInclusive: true, maxInclusive: false, points: 1 },
    { id: 'custom_upper', min: 2, max: null, minInclusive: true, maxInclusive: false, points: 2 },
  ];
  expect(isFixedRuleDefinition(d)).toBe(true);
  expect(validateRuleDefinition(d).filter(i => i.severity === 'error')).toEqual([]);
  rule.bands[0]!.max = 1.5;
  expect(validateRuleDefinition(d).some(i => i.code === 'OVERLAPPING_RANGES')).toBe(true);
  rule.input.id = 'height_cm';
  expect(isFixedRuleDefinition(d)).toBe(false);
});
