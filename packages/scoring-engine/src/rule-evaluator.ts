import { type RuleAnswers, type RuleDefinition, type RuleReference } from "@niq-scoring/contracts/rules";
import { inRange, validateRuleDefinition } from "@niq-scoring/contracts/rule-validation";
import { evaluateCondition, prepareAnswers, type EvaluationIssue, type RuntimeValue } from "./rule-answers";
export type RuleEvaluation = {
  complete: boolean;
  score: number | null;
  classification: { id: string; label: string; interpretation: string } | null;
  calculations: Record<string, number | null>;
  components: Array<{ id: string; domainId: string; label: string; points: number | null }>;
  domains: Record<string, number | null>;
  interventions: Array<{ id: string; label: string; kind: string; text: string }>;
  issues: EvaluationIssue[];
  visible: Record<string, boolean>;
};
const rounded = (value: number, precision: number) => Number(value.toFixed(precision));

/** Pure evaluation; API adds immutable version evidence and performs authorization/accounting. */
export function evaluateRule(definition: RuleDefinition, answers: RuleAnswers): RuleEvaluation {
  const structural = validateRuleDefinition(definition);
  const result: RuleEvaluation = { complete: false, score: null, classification: null, calculations: {}, components: [], domains: {}, interventions: [], issues: structural.map(({ path, code, message }) => ({ path, code, message })), visible: {} };
  if (structural.some(issue => issue.severity === "error")) return result;
  const prepared = prepareAnswers(definition, answers);
  result.visible = prepared.visible; result.issues.push(...prepared.issues);
  const add = (path: string, code: string, message: string) => result.issues.push({ path, code, message });
  const resolve = (ref: RuleReference): RuntimeValue | undefined => ref.kind === "question" ? prepared.values[ref.id] : ref.kind === "calculation" ? calculate(ref.id) : ref.kind === "domain" ? result.domains[ref.id] : ref.kind === "total" ? result.score : result.classification?.id;
  const calculations = new Map(definition.calculations.map(c => [c.id, c]));
  const calculate = (id: string): number | null => {
    if (id in result.calculations) return result.calculations[id]!;
    const calculation = calculations.get(id);
    if (!calculation) return null;
    const operands = calculation.operands.map(o => o.kind === "constant" ? o.value : resolve(o));
    if (operands.some(value => typeof value !== "number" || !Number.isFinite(value))) {
      result.calculations[id] = null; add(`calculations.${id}`, "MISSING_INPUT", "Calculation needs valid numeric inputs."); return null;
    }
    const numbers = operands as number[]; const a = numbers[0]!; const b = numbers[1]!;
    let value: number;
    switch (calculation.operation) {
      case "sum": value = numbers.reduce((sum, n) => sum + n, 0); break;
      case "multiply": value = numbers.reduce((product, n) => product * n, 1); break;
      case "subtract": value = a - b; break;
      case "divide": value = b === 0 ? NaN : a / b; break;
      case "bmi": value = a <= 0 || b <= 0 ? NaN : a / ((b / 100) ** 2); break;
      case "percentage_change": value = a <= 0 || b < 0 ? NaN : (a - b) / a * 100; break;
    }
    if (!Number.isFinite(value)) { add(`calculations.${id}`, "INVALID_CALCULATION", "Calculation is undefined or outside the numeric range."); result.calculations[id] = null; }
    else result.calculations[id] = rounded(value, calculation.precision);
    return result.calculations[id]!;
  };
  definition.calculations.forEach(c => calculate(c.id));
  for (const rule of definition.scoring) {
    let points: number | null = null;
    if (rule.kind === "options") {
      const answer = prepared.values[rule.questionId];
      const selected = typeof answer === "string" ? [answer] : Array.isArray(answer) ? answer : null;
      if (selected && selected.length) {
        const mapped = selected.map(optionId => rule.points.find(p => p.optionId === optionId)?.points);
        if (mapped.every(p => typeof p === "number")) {
          points = rule.aggregation === "sum" ? (mapped as number[]).reduce((sum, p) => sum + p, 0) : Math.max(...mapped as number[]);
          if (rule.cap !== null) points = Math.min(points, rule.cap);
        }
      }
    } else if (rule.kind === "ranges") {
      const input = resolve(rule.input);
      if (typeof input === "number") {
        const matches = rule.bands.filter(band => inRange(input, band));
        if (matches.length === 1) points = matches[0]!.points;
      }
    } else {
      const matched = evaluateCondition(rule.when, resolve);
      if (matched !== null) points = matched ? rule.points : rule.otherwise;
    }
    if (points !== null && !Number.isFinite(points)) points = null;
    if (points === null) add(`scoring.${rule.id}`, "INCOMPLETE_COMPONENT", "Scoring requires valid answers and exactly one defined outcome.");
    result.components.push({ id: rule.id, label: rule.label, domainId: rule.domainId, points });
  }
  for (const domain of definition.domains) {
    const components = result.components.filter(c => c.domainId === domain.id);
    if (!components.length || components.some(c => c.points === null)) { result.domains[domain.id] = null; continue; }
    const sum = components.reduce((total, c) => total + c.points!, 0);
    result.domains[domain.id] = Number.isFinite(sum) ? domain.cap === null ? sum : Math.min(sum, domain.cap) : null;
    if (result.domains[domain.id] === null) add(`domains.${domain.id}`, "INVALID_TOTAL", "Domain total exceeds the numeric range.");
  }
  // Partial calculations can be inspected, but no final score is emitted when definition or input is incomplete.
  const domains = Object.values(result.domains);
  if (!result.issues.length && domains.length && domains.every(value => value !== null)) {
    let score = definition.total.aggregation === "sum" ? (domains as number[]).reduce((total, value) => total + value, 0) : Math.max(...domains as number[]);
    if (definition.total.cap !== null) score = Math.min(score, definition.total.cap);
    if (!Number.isFinite(score)) add("total", "INVALID_TOTAL", "Total exceeds the numeric range.");
    else {
      result.score = rounded(score, definition.total.precision);
      const matches = definition.classifications.filter(band => inRange(result.score!, band));
      if (matches.length !== 1) add("classifications", "UNMATCHED_CLASSIFICATION", "Score must match exactly one classification.");
      else { const band = matches[0]!; result.classification = { id: band.id, label: band.label, interpretation: band.interpretation }; }
    }
  }
  if (!result.issues.length && result.classification) {
    const groups = new Set<string>(); const texts = new Set<string>();
    const ordered = definition.interventions.map((item, index) => ({ item, index })).sort((a, b) => b.item.priority - a.item.priority || a.index - b.index);
    for (const { item } of ordered) {
      const matched = evaluateCondition(item.when, resolve);
      if (matched === null) { add(`interventions.${item.id}`, "INCOMPLETE_INTERVENTION", "Guidance requires additional answers."); continue; }
      if (!matched || (item.exclusiveGroup && groups.has(item.exclusiveGroup))) continue;
      if (item.exclusiveGroup) groups.add(item.exclusiveGroup);
      const key = `${item.kind}:${item.text.trim()}`;
      if (texts.has(key)) continue;
      texts.add(key); result.interventions.push({ id: item.id, label: item.label, kind: item.kind, text: item.text });
    }
  }
  result.complete = result.issues.length === 0 && result.score !== null && result.classification !== null;
  if (!result.complete) { result.score = null; result.classification = null; result.interventions = []; }
  return result;
}

export function validateSamples(definition: RuleDefinition): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  if (!definition.samples.length) issues.push({ path: "samples", code: "NO_SAMPLES", message: "Add at least one independently specified complete sample case." });
  if (definition.samples.length && !definition.samples.some(s => s.expected.complete)) issues.push({ path: "samples", code: "NO_COMPLETE_SAMPLE", message: "Include a complete sample case." });
  for (const sample of definition.samples) {
    const actual = evaluateRule(definition, sample.answers); const expected = sample.expected;
    const compare = (field: string, actualValue: unknown, expectedValue: unknown) => {
      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) issues.push({ path: `samples.${sample.id}.${field}`, code: "SAMPLE_MISMATCH", message: `Sample ${sample.name}: ${field} expected ${JSON.stringify(expectedValue)}, received ${JSON.stringify(actualValue) ?? "unavailable"}.` });
    };
    compare("complete", actual.complete, expected.complete); compare("score", actual.score, expected.score);
    compare("classificationId", actual.classification?.id ?? null, expected.classificationId);
    compare("interventionIds", actual.interventions.map(i => i.id).sort(), [...expected.interventionIds].sort());
    for (const [id, value] of Object.entries(expected.domains)) compare(`domains.${id}`, actual.domains[id], value);
    for (const [id, value] of Object.entries(expected.calculations)) compare(`calculations.${id}`, actual.calculations[id], value);
  }
  return issues;
}
