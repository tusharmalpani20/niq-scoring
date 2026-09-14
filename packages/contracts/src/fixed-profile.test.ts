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
