import type { ReportEvidence } from "./report-content";

/** Routine target lines remain in the original report evidence and target
 * cards. They must not become extra effect-specific requirements just because
 * a status row also contains conditional symptom guidance. */
export function reportCardSources(evidence: ReportEvidence[]): ReportEvidence[] {
  const supplemental = evidence.filter(row => /^rule:(?:status|treatment|class):/.test(row.id)).map(row => ({ ...row,
    text: row.text.split("\n").filter(line => !/^\s*[•-]?\s*(?:achieve\s+)?(?:energy|protein)\s*:?\s*\d/i.test(line)
      || !/\b(?:kcal|g(?:\s+protein)?)\s*\/\s*kg\s*\/\s*day\b/i.test(line)).join("\n") }));
  return evidence.filter(row => row.id.startsWith("possible:toxicity:")).map(row => ({ ...row,
    text: `${row.text}\nSupplemental matched guidance, ONLY its instructions relevant to this card's effect: ${JSON.stringify(supplemental)}` }));
}
