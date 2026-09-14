import type { RuleDefinition, RuleQuestion } from '@niq-scoring/contracts/rules';
export const newRuleId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export function moveItem<T>(items: T[], index: number, delta: number): T[] {
    const target = index + delta;
    if (index < 0 || index >= items.length || target < 0 || target >= items.length)
        return items;
    const result = [...items];
    [result[index], result[target]] = [result[target]!, result[index]!];
    return result;
}
export function newQuestion(): RuleQuestion {
    return { id: newRuleId('question'), label: 'New question', type: 'text', purpose: 'assessment', help: '', unit: '', required: false, options: [], validation: {}, visibleWhen: null, sources: [] };
}
// Locate references without silently deleting dependent rules or sample expectations.
export function referencesTo(definition: RuleDefinition, ids: string[]): string[] {
    const targets = new Set(ids);
    const paths: string[] = [];
    const scan = (value: unknown, path: string) => {
        if (Array.isArray(value)) {
            value.forEach((item, index) => scan(item, `${path}[${index}]`));
            return;
        }
        if (!value || typeof value !== 'object')
            return;
        const object = value as Record<string, unknown>;
        if (typeof object.id === 'string' && targets.has(object.id) && !('kind' in object))
            return;
        for (const [key, child] of Object.entries(object)) {
            if ((key === 'id' && 'kind' in object || ['questionId', 'optionId', 'classificationId'].includes(key)) && typeof child === 'string' && targets.has(child))
                paths.push(`${path}.${key}`);
            else if ((key === 'answers' || key === 'calculations') && child && typeof child === 'object' && !Array.isArray(child)) {
                for (const [id, answer] of Object.entries(child)) {
                    if (targets.has(id) || key === 'answers' && (typeof answer === 'string' && targets.has(answer) || Array.isArray(answer) && answer.some(value => typeof value === 'string' && targets.has(value))))
                        paths.push(`${path}.${key}.${id}`);
                }
            }
            else if (key === 'value' && typeof child === 'string' && targets.has(child))
                paths.push(`${path}.${key}`);
            else
                scan(child, `${path}.${key}`);
        }
    };
    scan(definition, 'definition');
    return [...new Set(paths)];
}
export function changeQuestionType(question: RuleQuestion, type: RuleQuestion['type']): RuleQuestion {
    const select = type === 'single_select' || type === 'multi_select';
    return { ...question, type, validation: {}, options: select ? question.options.length ? question.options : [{ id: newRuleId('option'), label: 'New option', help: '' }] : [] };
}
