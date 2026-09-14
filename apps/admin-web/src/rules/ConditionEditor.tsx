import type { RuleCondition, RuleDefinition, RuleReference } from '@niq-scoring/contracts/rules';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { NativeSelect } from '../components/ui/native-select';
export function referenceChoices(definition: RuleDefinition, kinds: RuleReference['kind'][] = ['question', 'calculation', 'domain', 'total', 'classification']) {
    return [
        ...definition.sections.flatMap(s => s.questions.map(q => ({ kind: 'question' as const, id: q.id, label: q.label }))),
        ...definition.calculations.map(c => ({ kind: 'calculation' as const, id: c.id, label: c.label })),
        ...definition.domains.map(d => ({ kind: 'domain' as const, id: d.id, label: d.label })),
        { kind: 'total' as const, id: 'total', label: 'Total score' }, { kind: 'classification' as const, id: 'classification', label: 'Classification' },
    ].filter(r => kinds.includes(r.kind));
}
export function ConditionEditor({ definition, value, onChange, allowedKinds, disabled, required = false }: {
    definition: RuleDefinition;
    value: RuleCondition | null;
    onChange: (value: RuleCondition | null) => void;
    allowedKinds?: RuleReference['kind'][];
    disabled?: boolean;
    required?: boolean;
}) {
    const choices = referenceChoices(definition, allowedKinds);
    const first = choices[0];
    const add = () => first && onChange({ match: value?.match ?? 'all', tests: [...(value?.tests ?? []), { ref: { kind: first.kind, id: first.id }, operator: 'answered' }] });
    const update = (index: number, change: Partial<NonNullable<RuleCondition>['tests'][number]>) => value && onChange({ ...value, tests: value.tests.map((t, i) => i === index ? { ...t, ...change } : t) });
    return <fieldset disabled={disabled} className="space-y-3 rounded-md border p-3"><legend className="px-1 text-sm font-medium">Conditions</legend>
    {!value ? <><p className="text-sm text-muted-foreground">{required ? 'Add a condition to define when this applies.' : 'Always visible. Add a condition to show this question only when it applies.'}</p><Button type="button" variant="outline" disabled={!first} onClick={add}>Add condition</Button></> : <>
      <label className="block text-sm">Match<NativeSelect value={value.match} onChange={e => onChange({ ...value, match: e.target.value as 'all' | 'any' })}><option value="all">All conditions</option><option value="any">Any condition</option></NativeSelect></label>
      {value.tests.map((test, index) => {
                const question = definition.sections.flatMap(s => s.questions).find(q => test.ref.kind === 'question' && q.id === test.ref.id);
                const options = question?.options ?? (test.ref.kind === 'classification' ? definition.classifications : []);
                const numeric = test.ref.kind === 'calculation' || test.ref.kind === 'domain' || test.ref.kind === 'total' || question?.type === 'number';
                const operators = ['answered', 'unanswered', ...(question?.type === 'multi_select' ? ['includes'] : ['eq', 'neq']), ...(numeric ? ['gt', 'gte', 'lt', 'lte'] : [])];
                const labels: Record<string, string> = { answered: 'Has an answer', unanswered: 'Has no answer', eq: 'Equals', neq: 'Does not equal', gt: 'Greater than', gte: 'At least', lt: 'Less than', lte: 'At most', includes: 'Includes option' };
                return <div key={index} className="grid gap-2 rounded border p-2 sm:grid-cols-2">
          <label className="text-sm">Field<NativeSelect value={`${test.ref.kind}:${test.ref.id}`} onChange={e => { const choice = choices.find(c => `${c.kind}:${c.id}` === e.target.value); if (choice)
                    update(index, { ref: { kind: choice.kind, id: choice.id }, operator: 'answered', value: undefined }); }}>
            {!choices.some(c => c.id === test.ref.id && c.kind === test.ref.kind) && <option value={`${test.ref.kind}:${test.ref.id}`}>Missing field: {test.ref.id}</option>}
            {choices.map(c => <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>{c.label} ({c.kind})</option>)}
          </NativeSelect></label>
          <label className="text-sm">Comparison<NativeSelect value={test.operator} onChange={e => update(index, { operator: e.target.value as typeof test.operator, value: undefined })}>{operators.map(op => <option key={op} value={op}>{labels[op]}</option>)}</NativeSelect></label>
          {!['answered', 'unanswered'].includes(test.operator) && <label className="text-sm">Value{options.length ? <NativeSelect value={String(test.value ?? '')} onChange={e => update(index, { value: e.target.value })}><option value="">Select value</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect> : question?.type === 'boolean' ? <NativeSelect value={String(test.value ?? '')} onChange={e => update(index, { value: e.target.value === '' ? undefined : e.target.value === 'true' })}><option value="">Select value</option><option value="true">Yes</option><option value="false">No</option></NativeSelect> : <Input type={numeric ? 'number' : question?.type === 'date' ? 'date' : 'text'} value={test.value === undefined ? '' : String(test.value)} onChange={e => update(index, { value: e.target.value === '' ? undefined : numeric ? Number(e.target.value) : e.target.value })}/>}</label>}
          <Button type="button" variant="ghost" disabled={required && value.tests.length === 1} onClick={() => onChange(value.tests.length === 1 ? null : { ...value, tests: value.tests.filter((_, i) => i !== index) })}>Remove condition</Button>
        </div>;
            })}<Button type="button" variant="outline" disabled={!first || value.tests.length >= 50} onClick={add}>Add condition</Button>
    </>}
  </fieldset>;
}
