import { inRange } from "@niq-scoring/contracts/rule-validation";
import { isFinalAssessmentDefinition, type VersionedRuleDefinition } from "@niq-scoring/contracts/versioned-definition";

/** Shared by original calculations and reviewed totals; never substitutes a different rule version. */
export function classifyScore(definition: VersionedRuleDefinition, score: number) {
  const bands = isFinalAssessmentDefinition(definition) ? definition.riskCategories : definition.classifications;
  const matches = bands.filter(band => inRange(score, band));
  if (matches.length !== 1) return null;
  const band = matches[0]!;
  return { id: band.id, label: band.label, interpretation: band.interpretation, color: "color" in band ? band.color ?? "neutral" : "neutral" };
}
