import { useEffect, useState } from 'react';
import type { RuleDefinition, RuleQuestion } from '@niq-scoring/contracts/rules';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { NativeSelect } from '../components/ui/native-select';
import { ConditionEditor } from './ConditionEditor';
import { changeQuestionType, moveItem, newQuestion, newRuleId, referencesTo } from './questionnaire-model';
const types: Record<RuleQuestion['type'], string> = { text: 'Short text', long_text: 'Long text', number: 'Number', date: 'Date', boolean: 'Yes / no', single_select: 'Single choice', multi_select: 'Multiple choice' };
function Ordering({ index, count, label, move }: {
    index: number;
    count: number;
    label: string;
    move: (delta: number) => void;
}) {
    return <div className="flex gap-1"><Button type="button" variant="ghost" aria-label={`Move ${label} up`} title="Move up" disabled={index === 0} onClick={() => move(-1)}>↑</Button><Button type="button" variant="ghost" aria-label={`Move ${label} down`} title="Move down" disabled={index === count - 1} onClick={() => move(1)}>↓</Button></div>;
}
export function QuestionnaireEditor({ definition, onChange, disabled }: {
    definition: RuleDefinition;
    onChange: (definition: RuleDefinition) => void;
    disabled?: boolean;
}) {
    const [warning, setWarning] = useState<{
        paths: string[];
        apply: () => void;
    } | null>(null);
    useEffect(() => setWarning(null), [definition]);
    const guard = (ids: string[], apply: () => void) => { const paths = referencesTo(definition, ids); if (paths.length)
        setWarning({ paths, apply });
    else
        apply(); };
    const section = (index: number, change: Partial<RuleDefinition['sections'][number]>) => onChange({ ...definition, sections: definition.sections.map((s, i) => i === index ? { ...s, ...change } : s) });
    const question = (si: number, qi: number, change: Partial<RuleQuestion>) => section(si, { questions: definition.sections[si]!.questions.map((q, i) => i === qi ? { ...q, ...change } : q) });
    return <fieldset disabled={disabled} className="min-w-0 space-y-5">
    <p className="text-sm text-muted-foreground">Organize the questionnaire in the order people will answer it. Field identifiers stay the same when labels or order change.</p>
    {warning && <div role="alert" className="space-y-2 rounded-md border border-destructive p-3"><p>This change affects referenced fields. Dependent rules must be updated before the draft can be saved.</p><ul className="list-inside list-disc break-all text-sm">{warning.paths.map(p => <li key={p}>{p}</li>)}</ul><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setWarning(null)}>Keep field</Button><Button type="button" variant="destructive" onClick={() => { warning.apply(); setWarning(null); }}>Continue with change</Button></div></div>}
    {definition.sections.map((s, si) => <section key={s.id} id={`rule-section-${s.id}`} className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Section {si + 1}</h3><div className="flex items-center"><Ordering index={si} count={definition.sections.length} label={s.title} move={delta => onChange({ ...definition, sections: moveItem(definition.sections, si, delta) })}/><Button type="button" variant="ghost" onClick={() => guard(s.questions.flatMap(q => [q.id, ...q.options.map(o => o.id)]), () => onChange({ ...definition, sections: definition.sections.filter((_, i) => i !== si) }))}>Remove section</Button></div></div>
      <label className="block text-sm">Section title<Input value={s.title} maxLength={200} onChange={e => section(si, { title: e.target.value })}/></label>
      <label className="block text-sm">Section description<Textarea value={s.description} maxLength={2000} onChange={e => section(si, { description: e.target.value })}/></label>
      {s.questions.map((q, qi) => <details key={q.id} id={`rule-question-${q.id}`} className="rounded-md border bg-background p-3"><summary className="cursor-pointer font-medium">{qi + 1}. {q.label || 'Untitled question'} <span className="text-sm font-normal text-muted-foreground">· {types[q.type]}</span></summary><div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><code className="break-all text-xs text-muted-foreground">{q.id}</code><div className="flex items-center"><Ordering index={qi} count={s.questions.length} label={q.label} move={delta => section(si, { questions: moveItem(s.questions, qi, delta) })}/><Button type="button" variant="ghost" onClick={() => guard([q.id, ...q.options.map(o => o.id)], () => section(si, { questions: s.questions.filter((_, i) => i !== qi) }))}>Remove question</Button></div></div>
        <label className="block text-sm">Question label<Input value={q.label} maxLength={200} onChange={e => question(si, qi, { label: e.target.value })}/></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Field type<NativeSelect value={q.type} onChange={e => { const type = e.target.value as RuleQuestion['type']; guard([q.id, ...q.options.map(o => o.id)], () => question(si, qi, changeQuestionType(q, type))); }}>{Object.entries(types).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</NativeSelect></label>
          <label className="text-sm">Purpose<NativeSelect value={q.purpose} onChange={e => question(si, qi, { purpose: e.target.value as RuleQuestion['purpose'] })}><option value="assessment">Assessment</option><option value="scoring">Scoring</option><option value="clinician">Clinician</option></NativeSelect></label></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.required} onChange={e => question(si, qi, { required: e.target.checked })}/>Required answer</label>
        <label className="block text-sm">Help text<Textarea value={q.help} maxLength={4000} onChange={e => question(si, qi, { help: e.target.value })}/></label>
        <label className="block text-sm">Unit<Input value={q.unit} maxLength={40} onChange={e => question(si, qi, { unit: e.target.value })}/></label>
        <div className="grid gap-3 sm:grid-cols-2">
          {q.type === 'number' && <>{(['min', 'max'] as const).map(key => <label key={key} className="text-sm">{key === 'min' ? 'Minimum' : 'Maximum'}<Input type="number" value={q.validation[key] ?? ''} onChange={e => question(si, qi, { validation: { ...q.validation, [key]: e.target.value === '' ? undefined : Number(e.target.value) } })}/></label>)}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.validation.integer ?? false} onChange={e => question(si, qi, { validation: { ...q.validation, integer: e.target.checked } })}/>Whole numbers only</label></>}
          {['text', 'long_text'].includes(q.type) && <label className="text-sm">Maximum characters<Input type="number" min={1} max={20000} value={q.validation.maxLength ?? ''} onChange={e => question(si, qi, { validation: { ...q.validation, maxLength: e.target.value === '' ? undefined : Number(e.target.value) } })}/></label>}
          {q.type === 'date' && (['minDate', 'maxDate'] as const).map(key => <label key={key} className="text-sm">{key === 'minDate' ? 'Earliest date' : 'Latest date'}<Input type="date" value={q.validation[key] ?? ''} onChange={e => question(si, qi, { validation: { ...q.validation, [key]: e.target.value || undefined } })}/></label>)}
        </div>
        {['single_select', 'multi_select'].includes(q.type) && <fieldset className="space-y-2 rounded border p-3"><legend className="px-1 text-sm">Answer options</legend>{q.options.map((o, oi) => <div key={o.id} className="space-y-2 rounded border p-2"><label className="block text-sm">Option label<Input value={o.label} maxLength={200} onChange={e => question(si, qi, { options: q.options.map((item, i) => i === oi ? { ...item, label: e.target.value } : item) })}/></label><label className="block text-sm">Option help<Input value={o.help} maxLength={2000} onChange={e => question(si, qi, { options: q.options.map((item, i) => i === oi ? { ...item, help: e.target.value } : item) })}/></label><div className="flex justify-end"><Ordering index={oi} count={q.options.length} label={o.label} move={delta => question(si, qi, { options: moveItem(q.options, oi, delta) })}/><Button type="button" variant="ghost" onClick={() => guard([o.id], () => question(si, qi, { options: q.options.filter((_, i) => i !== oi) }))}>Remove option</Button></div></div>)}<Button type="button" variant="outline" disabled={q.options.length >= 200} onClick={() => question(si, qi, { options: [...q.options, { id: newRuleId('option'), label: 'New option', help: '' }] })}>Add option</Button></fieldset>}
        <ConditionEditor definition={definition} value={q.visibleWhen} onChange={visibleWhen => question(si, qi, { visibleWhen })} allowedKinds={['question']} disabled={!!disabled}/>
        {!!q.sources.length && <p className="text-xs text-muted-foreground">Sources: {q.sources.map(source => `${source.document} · ${source.location}`).join('; ')}</p>}
      </div></details>)}
      <Button type="button" variant="outline" disabled={s.questions.length >= 200} onClick={() => section(si, { questions: [...s.questions, newQuestion()] })}>Add question</Button>
    </section>)}
    <Button type="button" variant="outline" disabled={definition.sections.length >= 50} onClick={() => onChange({ ...definition, sections: [...definition.sections, { id: newRuleId('section'), title: 'New section', description: '', questions: [] }] })}>Add section</Button>
    <CalculationEditor definition={definition} onChange={onChange} guard={guard}/>
  </fieldset>;
}
function CalculationEditor({ definition, onChange, guard }: {
    definition: RuleDefinition;
    onChange: (d: RuleDefinition) => void;
    guard: (ids: string[], apply: () => void) => void;
}) {
    const update = (index: number, changes: Partial<RuleDefinition['calculations'][number]>) => onChange({ ...definition, calculations: definition.calculations.map((c, i) => i === index ? { ...c, ...changes } : c) });
    const fields = [...definition.sections.flatMap(s => s.questions.filter(q => q.type === 'number').map(q => ({ kind: 'question' as const, id: q.id, label: q.label }))), ...definition.calculations.map(c => ({ kind: 'calculation' as const, id: c.id, label: c.label }))];
    return <section className="space-y-3 border-t pt-4"><h3 className="font-medium">Calculated values</h3><p className="text-sm text-muted-foreground">Operands are evaluated in the displayed order. BMI uses weight in kg then height in cm. Percentage change uses baseline then current value.</p>{definition.calculations.map((c, ci) => <fieldset key={c.id} id={`rule-calculations-${c.id}`} className="space-y-3 rounded border p-3"><legend className="px-1 text-sm">{c.label}</legend><label className="block text-sm">Calculation label<Input value={c.label} onChange={e => update(ci, { label: e.target.value })}/></label><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Operation<NativeSelect value={c.operation} onChange={e => update(ci, { operation: e.target.value as typeof c.operation })}>{['sum', 'subtract', 'multiply', 'divide', 'bmi', 'percentage_change'].map(op => <option key={op} value={op}>{op.replaceAll('_', ' ')}</option>)}</NativeSelect></label><label className="text-sm">Unit<Input value={c.unit} onChange={e => update(ci, { unit: e.target.value })}/></label><label className="text-sm">Decimal places<Input type="number" min={0} max={6} value={c.precision} onChange={e => update(ci, { precision: Number(e.target.value) })}/></label></div>
    {c.operands.map((operand, oi) => <div key={oi} className="flex flex-wrap items-end gap-2"><label className="min-w-40 flex-1 text-sm">Operand {oi + 1}<NativeSelect value={operand.kind === 'constant' ? 'constant' : `${operand.kind}:${operand.id}`} onChange={e => { const field = fields.find(f => `${f.kind}:${f.id}` === e.target.value); update(ci, { operands: c.operands.map((o, i) => i !== oi ? o : field ? { kind: field.kind, id: field.id } : { kind: 'constant', value: 0 }) }); }}><option value="constant">Fixed number</option>{fields.filter(f => f.id !== c.id).map(f => <option key={f.id} value={`${f.kind}:${f.id}`}>{f.label}</option>)}</NativeSelect></label>{operand.kind === 'constant' && <label className="text-sm">Number<Input type="number" value={operand.value} onChange={e => update(ci, { operands: c.operands.map((o, i) => i === oi ? { kind: 'constant', value: Number(e.target.value) } : o) })}/></label>}<Ordering index={oi} count={c.operands.length} label={`operand ${oi + 1}`} move={delta => update(ci, { operands: moveItem(c.operands, oi, delta) })}/><Button type="button" variant="ghost" onClick={() => update(ci, { operands: c.operands.filter((_, i) => i !== oi) })}>Remove operand</Button></div>)}<div className="flex gap-2"><Button type="button" variant="outline" disabled={c.operands.length >= 30} onClick={() => update(ci, { operands: [...c.operands, { kind: 'constant', value: 0 }] })}>Add operand</Button><Button type="button" variant="ghost" onClick={() => guard([c.id], () => onChange({ ...definition, calculations: definition.calculations.filter((_, i) => i !== ci) }))}>Remove calculation</Button></div></fieldset>)}<Button type="button" variant="outline" disabled={definition.calculations.length >= 200} onClick={() => onChange({ ...definition, calculations: [...definition.calculations, { id: newRuleId('calculation'), label: 'New calculation', unit: '', operation: 'sum', operands: [{ kind: 'constant', value: 0 }], precision: 2, sources: [] }] })}>Add calculation</Button></section>;
}
