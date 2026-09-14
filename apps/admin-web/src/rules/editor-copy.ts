import type { RuleDefinition } from '@niq-scoring/contracts/rules';

// Source provenance remains in the saved definition; the editor describes the configuration task.
const decisionCopy: Record<string, string> = {
  domain_mapping: 'Choose a scoring domain for each component.',
  model_difference: 'Use a total cap of 35 and three risk categories as the starting configuration.',
  functional_difference: 'Functional capacity starts at 0, 1 and 2 points. Review the configured scores.',
  biomedical_thresholds: 'Confirm lab units and thresholds, including values exactly on a boundary. Haemoglobin ranges overlap; several other lab scores are not yet defined.',
  symptom_overlap: 'Confirm how overlapping GI and dietary symptoms are counted and whether the GI cap of 6 applies.',
  score_ranges: 'Risk categories start at 0–15, 16–25 and above 25. Confirm rounding and how fractional scores are handled.',
  previous_history_scoring: 'Confirm how previous surgery and long-term illness are recorded before scoring their presence. An unanswered text field does not mean no history.',
  medication_aggregation: 'Each selected medication or supplement starts at one point. Confirm how multiple medicines within a category are counted and whether a combined cap applies.',
};
export function decisionText(issue: RuleDefinition['issues'][number]) {
  return decisionCopy[issue.id] ?? issue.message;
}
export function descriptionText(description: string) {
  return description.startsWith('Fixed questionnaire and scoring defaults from the NIQ assessment workbook.') || description.startsWith('Questionnaire transcribed from the supplied NIQ assessment workbook.') ? '' : description;
}
