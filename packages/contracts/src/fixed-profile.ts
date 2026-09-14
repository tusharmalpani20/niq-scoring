import { ruleDefinitionSchema, type RuleDefinition } from "./rule-definition";
import { createSpreadsheetTemplate } from "./rule-template";

// Compare data semantically: PostgreSQL JSONB does not preserve object key order.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function structure(d: RuleDefinition) {
  return {
    sections: d.sections,
    calculations: d.calculations,
    total: { aggregation: d.total.aggregation, precision: d.total.precision },
    // Real score groups are editable; the placeholder cannot become a scored group.
    domains: d.domains.filter(domain => domain.id === "unassigned"),
    scoring: d.scoring.map(rule => {
      const { domainId: _domain, ...base } = rule;
      if (base.kind === "options") {
        const { points: _points, cap: _cap, aggregation: _aggregation, ...fixed } = base;
        return fixed;
      }
      if (base.kind === "ranges") { const { bands: _bands, ...fixed } = base; return fixed; }
      return { ...base, points: undefined, otherwise: undefined, when: { ...base.when, tests: base.when.tests.map(test => ({ ...test, value: typeof test.value === "number" ? undefined : test.value })) } };
    }),
    issues: d.issues.map(({ resolved: _resolved, resolution: _resolution, ...issue }) => issue),
  };
}

/** User-configurable scores/caps never change the source-owned questionnaire or calculation graph. */
export function isFixedRuleDefinition(value: unknown): boolean {
  const parsed = ruleDefinitionSchema.safeParse(value);
  if (!parsed.success) return false;
  const definition = parsed.data;
  return stable(structure(definition)) === stable(structure(createSpreadsheetTemplate(definition.name)));
}
