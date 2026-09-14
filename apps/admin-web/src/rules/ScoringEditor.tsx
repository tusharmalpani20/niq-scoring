import { Fragment, useState } from 'react';
import type { RuleDefinition, RuleQuestion } from '@niq-scoring/contracts/rules';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { newRuleId } from './questionnaire-model';
import { ScoringField, ScoringNumber, ScoringSelect, RangeFields } from './scoring-controls';
import { scoringReferences } from './scoring-model';
import { describeCondition } from './QuestionnaireEditor';

type Props = { definition: RuleDefinition; onChange: (definition: RuleDefinition) => void; disabled?: boolean };
type Score = RuleDefinition['scoring'][number];
const typeLabels: Record<RuleQuestion['type'], string> = { text: 'Text', long_text: 'Text', date: 'Date', number: 'Number', boolean: 'Yes/No', single_select: 'Select', multi_select: 'Multi-select' };
function usesField(rule: Score, id: string) {
  return rule.kind === 'options' ? rule.questionId === id : rule.kind === 'ranges' ? rule.input.id === id : rule.when.tests.some(test => test.ref.id === id);
}
function scoreSummary(rule: Score, question?: RuleQuestion) {
  if (rule.kind === 'options') return `${question?.options.filter(option => rule.points.some(point => point.optionId === option.id)).length ?? rule.points.length}/${question?.options.length ?? rule.points.length} configured`;
  if (rule.kind === 'ranges') return `${rule.bands.length} ranges configured`;
  return question?.type === 'boolean' ? '2/2 configured' : 'Configure score';
}

export function ScoringEditor({ definition: d, onChange, disabled = false }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const patch = (rule: Score) => onChange({ ...d, scoring: d.scoring.map(item => item.id === rule.id ? rule : item) });
  const domains = d.domains.filter(domain => domain.id !== 'unassigned');
  const groups = [
    ...d.sections.map(section => ({ id: section.id, title: section.title, fields: section.questions.map(question => ({ id: question.id, label: question.label, unit: question.unit, question })) })),
    { id: 'calculations', title: 'Calculated values', fields: d.calculations.map(calculation => ({ id: calculation.id, label: calculation.label, unit: calculation.unit, question: undefined })) },
  ];
  return <div className="min-w-0 space-y-5">
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card shadow-sm"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/30"><tr><th className="p-3 font-medium">Field name</th><th className="p-3 font-medium">Type</th><th className="p-3 font-medium">Score</th><th className="w-32 p-3 font-medium">Cap</th></tr></thead><tbody>
      {groups.filter(group => group.fields.length).map(group => <Fragment key={group.id}>
        <tr className="border-b bg-muted/20"><th colSpan={4} className="px-3 py-2 text-xs font-medium text-muted-foreground">{group.title}</th></tr>
        {group.fields.map(field => {
          const rules = d.scoring.filter(rule => usesField(rule, field.id));
          const capRule = field.question?.type === 'multi_select' ? rules.find(rule => rule.kind === 'options') : undefined;
          return <Fragment key={field.id}><tr id={`rule-field-${field.id}`} className="border-b last:border-b-0">
            <td className="p-3 font-medium">{field.label}{field.unit && <span className="ml-1 font-normal text-muted-foreground">({field.unit})</span>}</td>
            <td className="p-3 text-muted-foreground">{!field.question ? 'Calculated' : rules.some(rule => rule.kind === 'ranges') ? 'Range' : typeLabels[field.question.type]}</td>
            <td className="p-3">{rules.length ? <div className="flex flex-col items-start gap-1">{rules.map(rule => <button key={rule.id} type="button" className="text-primary underline-offset-4 hover:underline" aria-expanded={expanded === `${field.id}:${rule.id}`} aria-controls={`rule-scoring-${rule.id}`} onClick={() => setExpanded(expanded === `${field.id}:${rule.id}` ? null : `${field.id}:${rule.id}`)}>{scoreSummary(rule, field.question)}</button>)}</div> : <span className="text-muted-foreground">{field.question?.purpose === 'scoring' ? 'Not configured' : 'Not applicable'}</span>}</td>
            <td className="p-3">{capRule?.kind === 'options' ? <Input disabled={disabled} type="number" min={0} step="any" aria-label={`${field.label} cap`} placeholder="No cap" value={capRule.cap ?? ''} onChange={event => patch({ ...capRule, cap: event.target.value === '' ? null : Number(event.target.value) })}/> : <span className="text-muted-foreground">—</span>}</td>
          </tr>{rules.filter(rule => expanded === `${field.id}:${rule.id}`).map(rule => <tr key={rule.id}><td colSpan={4} className="border-b bg-muted/10 p-4"><fieldset disabled={disabled} id={`rule-scoring-${rule.id}`} aria-label={`${field.label} scoring`} className="space-y-4">
            <div className="max-w-sm"><ScoringSelect label="Domain" value={rule.domainId} options={[{ value: 'unassigned', label: 'Choose domain' }, ...domains.map(domain => ({ value: domain.id, label: domain.label }))]} onChange={domainId => patch({ ...rule, domainId })}/></div>
            {field.question?.type === 'number' && <p className="text-sm text-muted-foreground">Accepted values: {field.question.validation.min ?? 'no minimum'} to {field.question.validation.max ?? 'no maximum'}{field.unit ? ` ${field.unit}` : ''}.</p>}
            {rule.kind === 'options' && <OptionsScoring question={field.question} rule={rule} onChange={patch}/>}
            {rule.kind === 'ranges' && <div className="space-y-3">{rule.bands.map((band, index) => <div key={band.id} className="space-y-3 rounded-md border p-3"><div className="flex items-center justify-between"><h4 className="font-medium">Range {index + 1}</h4><Button type="button" variant="ghost" onClick={() => patch({ ...rule, bands: rule.bands.filter((_, i) => i !== index) })}>Remove range</Button></div><RangeFields value={band} onChange={value => patch({ ...rule, bands: rule.bands.map((item, i) => i === index ? { ...item, ...value } : item) })}/><ScoringNumber label="Range points" value={band.points} onChange={points => patch({ ...rule, bands: rule.bands.map((item, i) => i === index ? { ...item, points: points ?? 0 } : item) })}/></div>)}<Button type="button" variant="outline" onClick={() => patch({ ...rule, bands: [...rule.bands, { id: newRuleId('range'), min: null, max: null, minInclusive: true, maxInclusive: false, points: 0 }] })}>Add range</Button></div>}
            {rule.kind === 'condition' && <>{field.question?.type !== 'boolean' && <p className="text-sm">When {describeCondition(d, rule.when)}.</p>}{rule.when.tests.map((test, index) => typeof test.value === 'number' ? <ScoringNumber key={index} label={`Condition threshold ${index + 1}`} value={test.value} onChange={value => patch({ ...rule, when: { ...rule.when, tests: rule.when.tests.map((item, i) => i === index ? { ...item, value: value ?? 0 } : item) } })}/> : null)}<div className="grid gap-3 sm:grid-cols-2"><ScoringNumber label={field.question?.type === 'boolean' ? 'Yes' : 'Points when matched'} value={rule.points} onChange={points => patch({ ...rule, points: points ?? 0 })}/><ScoringNumber label={field.question?.type === 'boolean' ? 'No' : 'Points otherwise'} value={rule.otherwise} onChange={otherwise => patch({ ...rule, otherwise: otherwise ?? 0 })}/></div></>}
          </fieldset></td></tr>)}</Fragment>;
        })}
      </Fragment>)}
    </tbody></table></div>
    <details className="rounded-2xl border border-border/50 bg-card shadow-sm"><summary className="cursor-pointer p-4 font-medium">Domain and total caps</summary><fieldset disabled={disabled} className="grid gap-4 border-t p-4 sm:grid-cols-3">{domains.map(domain => <div key={domain.id} id={`rule-domains-${domain.id}`}><ScoringNumber label={`${domain.label} cap`} min={0} value={domain.cap} onChange={cap => onChange({ ...d, domains: d.domains.map(item => item.id === domain.id ? { ...item, cap } : item) })}/></div>)}<ScoringNumber label="Total cap" min={0} value={d.total.cap} onChange={cap => onChange({ ...d, total: { ...d.total, cap } })}/><p className="text-sm text-muted-foreground sm:col-span-3">Leave a cap blank for no upper limit.</p></fieldset></details>
    <details className="rounded-2xl border border-border/50 bg-card shadow-sm"><summary className="cursor-pointer p-4 font-medium">Risk categories</summary><fieldset disabled={disabled} className="border-t p-4">
    <section className="space-y-4"><h3 className="text-lg font-medium">Classifications</h3><p className="text-sm text-muted-foreground">Define non-overlapping ranges covering every possible total score.</p>{d.classifications.map((item,index)=>{const uses=scoringReferences(d,'classification',item.id);return <div key={item.id} id={`rule-classifications-${item.id}`} className="space-y-3 rounded-lg border p-4"><ScoringField label="Classification name"><Input aria-label="Classification name" value={item.label} onChange={e=>onChange({...d,classifications:d.classifications.map((v,i)=>i===index?{...v,label:e.target.value}:v)})}/></ScoringField><RangeFields value={item} onChange={value=>onChange({...d,classifications:d.classifications.map((v,i)=>i===index?{...v,...value}:v)})}/><ScoringField label="Interpretation"><Input aria-label="Interpretation" value={item.interpretation} onChange={e=>onChange({...d,classifications:d.classifications.map((v,i)=>i===index?{...v,interpretation:e.target.value}:v)})}/></ScoringField><Button type="button" variant="outline" disabled={uses.length>0} onClick={()=>onChange({...d,classifications:d.classifications.filter((_,i)=>i!==index)})}>Remove classification</Button>{uses.length>0&&<p className="text-sm text-muted-foreground">Used by {uses.join(', ')}. Remove these references first.</p>}</div>})}<Button type="button" variant="outline" onClick={()=>onChange({...d,classifications:[...d.classifications,{id:newRuleId('classification'),label:'New classification',interpretation:'',min:null,max:null,minInclusive:true,maxInclusive:true,sources:[]}]})}>Add classification</Button></section>    </fieldset></details>
  </div>;
}
function OptionsScoring({ question, rule, onChange }: { question: RuleQuestion | undefined; rule: Extract<Score, { kind: 'options' }>; onChange: (rule: Score) => void }) {
  const options = question?.options ?? [];
  const setPoints = (optionId: string, points: number | null) => {
    const configured = new Map(rule.points.map(item => [item.optionId, item.points]));
    // Clearing a score leaves it unresolved, rather than silently assigning zero.
    if (points === null) configured.delete(optionId); else configured.set(optionId, points);
    onChange({ ...rule, points: options.flatMap(option => { const value = configured.get(option.id); return value === undefined ? [] : [{ optionId: option.id, points: value }]; }) });
  };
  return <><div className="grid gap-3 sm:grid-cols-2">{options.map(option => <ScoringNumber key={option.id} label={option.label} value={rule.points.find(item => item.optionId === option.id)?.points ?? null} onChange={value => setPoints(option.id, value)}/>)}</div>{question?.type === 'multi_select' && <div className="max-w-sm"><ScoringSelect label="Combine selected options" value={rule.aggregation} options={[{ value: 'sum', label: 'Add points together' }, { value: 'max', label: 'Use highest points' }]} onChange={value => onChange({ ...rule, aggregation: value as 'sum' | 'max' })}/></div>}</>;
}
