import type { RuleDefinition } from '@niq-scoring/contracts/rules';
export function scoringReferences(definition: RuleDefinition, kind: 'domain' | 'classification' | 'intervention', id: string): string[] {
  const uses: string[] = [];
  if (kind === 'domain') definition.scoring.forEach(rule => { if (rule.domainId === id) uses.push(rule.label); });
  definition.interventions.forEach(rule => { if (rule.when.tests.some(test => test.ref.kind === kind && test.ref.id === id || kind === 'classification' && test.ref.kind === 'classification' && test.value === id)) uses.push(rule.label); });
  definition.samples.forEach(sample => { if (kind === 'domain' && id in sample.expected.domains || kind === 'classification' && sample.expected.classificationId === id || kind === 'intervention' && sample.expected.interventionIds.includes(id)) uses.push(`Sample: ${sample.name}`); });
  return [...new Set(uses)];
}
export function optionPoints(definition: RuleDefinition, questionId: string) {
  return definition.sections.flatMap(section => section.questions).find(question => question.id === questionId)?.options.map(option => ({ optionId: option.id, points: 0 })) ?? [];
}

export function synchronizeOptionPoints(definition: RuleDefinition, rule: Extract<RuleDefinition['scoring'][number], {kind:'options'}>) {
  return optionPoints(definition, rule.questionId).map(point => ({...point, points:rule.points.find(existing=>existing.optionId===point.optionId)?.points ?? 0}));
}
