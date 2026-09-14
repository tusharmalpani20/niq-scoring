import { describe, expect, test } from 'bun:test';
import { blankRuleDefinition } from '@niq-scoring/contracts/rules';
import { changeQuestionType, moveItem, newQuestion, referencesTo } from '../src/rules/questionnaire-model';

describe('questionnaire editing', () => {
  test('labels and reorder retain independent field identities', () => {
    const first = newQuestion(), second = newQuestion();
    expect(first.id).not.toBe(second.id);
    const reordered = moveItem([{ ...first, label: 'Changed' }, second], 0, 1);
    expect(reordered.map(q => q.id)).toEqual([second.id, first.id]);
    expect(moveItem(reordered, 0, -1)).toBe(reordered);
  });
  test('type changes reset incompatible validation while retaining question identity', () => {
    const original = { ...newQuestion(), validation: { maxLength: 20 } };
    const select = changeQuestionType(original, 'single_select');
    expect(select.id).toBe(original.id);
    expect(select.options).toHaveLength(1);
    expect(select.validation).toEqual({});
    expect(changeQuestionType(select, 'multi_select').options[0]?.id).toBe(select.options[0]?.id);
    expect(changeQuestionType(select, 'number').options).toEqual([]);
  });
  test('removing a question warns about dependent calculations, conditions and sample answers', () => {
    const definition = blankRuleDefinition('Test');
    const q = newQuestion();
    const other = { ...newQuestion(), visibleWhen: { match: 'all' as const, tests: [{ ref: { kind: 'question' as const, id: q.id }, operator: 'answered' as const }] } };
    definition.sections = [{ id: 'section', title: 'Section', description: '', questions: [q, other] }];
    definition.calculations = [{ id: 'calc', label: 'Calc', unit: '', operation: 'sum', precision: 0, operands: [{ kind: 'question', id: q.id }], sources: [] }];
    definition.samples = [{ id: 'sample', name: 'Sample', answers: { [q.id]: 1 }, expected: { complete: false, score: null, classificationId: null, interventionIds: [], calculations: {}, domains: {} } }];
    expect(referencesTo(definition, [q.id])).toHaveLength(3);
    expect(referencesTo(definition, [other.id])).toEqual([]);
  });
  test('removing an option finds visibility conditions and scoring mappings', () => {
    const definition = blankRuleDefinition('Test');
    definition.scoring = [{ id: 'score', label: 'Score', domainId: 'domain', sources: [], kind: 'options', questionId: 'question', points: [{ optionId: 'option', points: 2 }], aggregation: 'sum', cap: null }];
    definition.interventions = [{ id: 'care', label: 'Care', kind: 'note', text: 'Note', priority: 0, exclusiveGroup: null, sources: [], when: { match: 'all', tests: [{ ref: { kind: 'question', id: 'question' }, operator: 'eq', value: 'option' }] } }];
    expect(referencesTo(definition, ['option'])).toHaveLength(2);
  });
});
