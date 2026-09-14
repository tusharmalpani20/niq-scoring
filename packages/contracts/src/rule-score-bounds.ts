import type { RuleDefinition } from "./rule-definition";

type Bounds = { min: number; max: number };
const capped = (bounds: Bounds, cap: number | null): Bounds => cap === null ? bounds :
  { min: Math.min(bounds.min, cap), max: Math.min(bounds.max, cap) };
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Conservative bounds: do not assume that conditions on separate rules are correlated.
 * Missing/hidden answers have no complete score and therefore contribute no invented zero.
 */
export function ruleScoreBounds(definition: RuleDefinition): Bounds | null {
  const questions = new Map(definition.sections.flatMap(s => s.questions).map(q => [q.id, q]));
  const components = definition.scoring.map(rule => {
    const points = rule.kind === "options" ? rule.points.map(p => p.points) :
      rule.kind === "ranges" ? rule.bands.map(b => b.points) : [rule.points, rule.otherwise];
    if (!points.length) return null;
    let bounds = { min: Math.min(...points), max: Math.max(...points) };
    if (rule.kind === "options") {
      if (questions.get(rule.questionId)?.type === "multi_select" && rule.aggregation === "sum") {
        // A complete selection is nonempty: when all points have one sign, the
        // opposite extreme is the smallest-magnitude singleton, not an empty sum.
        bounds = {
          min: points.some(p => p < 0) ? sum(points.filter(p => p < 0)) : bounds.min,
          max: points.some(p => p > 0) ? sum(points.filter(p => p > 0)) : bounds.max,
        };
      }
      bounds = capped(bounds, rule.cap);
    }
    return { ...bounds, domainId: rule.domainId };
  });
  const domains: Bounds[] = [];
  for (const domain of definition.domains) {
    // The unassigned bucket is authoring state, never a clinical domain.
    if (domain.id === "unassigned" && !definition.scoring.some(rule => rule.domainId === domain.id)) continue;
    const members = components.filter(c => c?.domainId === domain.id);
    if (!members.length || definition.scoring.some((r, i) => r.domainId === domain.id && !components[i])) return null;
    domains.push(capped({ min: sum(members.map(c => c!.min)), max: sum(members.map(c => c!.max)) }, domain.cap));
  }
  if (!domains.length) return null;
  const aggregate = definition.total.aggregation === "sum" ? sum : (values: number[]) => Math.max(...values);
  const total = capped({ min: aggregate(domains.map(d => d.min)), max: aggregate(domains.map(d => d.max)) }, definition.total.cap);
  return { min: Number(total.min.toFixed(definition.total.precision)), max: Number(total.max.toFixed(definition.total.precision)) };
}
