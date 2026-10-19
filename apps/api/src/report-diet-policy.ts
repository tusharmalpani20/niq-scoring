import type { ReportEvidence } from "./report-content";

export const REPORT_DIET_POLICY = `Respect the explicitly recorded patient diet in every narrative and possible-effect card, even when a matched source lists broader food examples. For Vegetarian or Jain preferences, omit egg, fish, chicken, meat and poultry recommendations. For Eggetarian preferences, eggs are compatible but fish, chicken, meat and poultry are not. Select compatible examples already supported by the source, or omit the incompatible example without inventing replacements. Do not infer a diet when it is unrecorded. Do not infer additional Jain restrictions from the label alone. Negative restrictions are not positive food recommendations. Preserve all other source-supported instructions and qualifications.`;

const foods = [
  {name: "eggs", pattern: /\beggs?\b/giu},
  {name: "fish", pattern: /\bfish\b/giu},
  {name: "chicken", pattern: /\bchicken\b/giu},
  {name: "meat", pattern: /\bmeat\b/giu},
  {name: "poultry", pattern: /\bpoultry\b/giu},
];
const instruction = /\b(?:(?:do not|don['’]t|never)\s+(?:eat|have|try|include|choose)|avoid|exclude|excluding|without|except|free of|not(?!\s+only\b)|such as|options?|include|choose|try|eat|have)\b/giu;
const negative = /^(?:(?:do not|don['’]t|never)\b|avoid\b|exclude\b|excluding\b|without\b|except\b|free of\b|not\b)/iu;

/** A narrow compatibility guard for explicit food recommendations. It does not
 * infer a diagnosis, a new dietary restriction, or a replacement food. Source
 * completeness and clinical meaning still receive independent model review. */
export function dietRecommendationIssues(text: string, evidence: ReportEvidence[]): string[] {
  const recorded = evidence.find(row => row.id === "fact:diet_preference")?.text;
  const label = recorded?.match(/\bdiet preference:\s*(vegetarian|jain|eggetarian|non[ -]vegetarian)\s*$/iu)?.[1]?.toLowerCase();
  if (!label || label.startsWith("non")) return [];
  const issues: string[] = [];
  const sentences = text.split(/[.!?\n]|\b(?:but|however)\b/iu);
  for (const food of foods) {
    if (food.name === "eggs" && label === "eggetarian") continue;
    const recommended = sentences.some(sentence => Array.from(sentence.matchAll(food.pattern)).some(match => {
      // A recorded allergy/intolerance is a clinical label, not an instruction
      // to consume that food (for example "You have an egg allergy").
      if (/^\s+(?:allergy|intolerance)\b/iu.test(sentence.slice(match.index! + match[0].length))) return false;
      const preceding = sentence.slice(0, match.index);
      const nearest = Array.from(preceding.matchAll(instruction)).at(-1)?.[0];
      return Boolean(nearest && !negative.test(nearest));
    }));
    if (recommended) issues.push(`DIET_INCOMPATIBLE_FOOD:${food.name}`);
  }
  return issues;
}
