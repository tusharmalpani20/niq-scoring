import type { RuleDefinition } from '@niq-scoring/contracts/rules';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { newRuleId } from './questionnaire-model';
import { ScoringField, ScoringNumber, ScoringSelect, RangeFields } from './scoring-controls';
import { scoringReferences } from './scoring-model';
import { describeCondition } from './QuestionnaireEditor';

type Props = { definition: RuleDefinition; onChange: (definition: RuleDefinition) => void; disabled?: boolean };
type Score = RuleDefinition['scoring'][number];

export function ScoringEditor({ definition: d, onChange, disabled = false }: Props) {
  const questions = d.sections.flatMap(section => section.questions);
  const patch = (index: number, rule: Score) => onChange({ ...d, scoring: d.scoring.map((item, i) => i === index ? rule : item) });
  const domains = d.domains.filter(domain => domain.id !== 'unassigned');
  return <fieldset disabled={disabled} className="min-w-0 space-y-8">
    <p className="text-sm text-muted-foreground">Configure points, thresholds and caps. Leave a cap blank for no upper limit.</p>
    <section className="space-y-4"><h3 className="text-lg font-medium">Domain caps</h3><div className="grid gap-3 sm:grid-cols-2">{domains.map(domain => <div key={domain.id} id={`rule-domains-${domain.id}`} className="space-y-3 rounded-lg border p-4"><h4 className="font-medium">{domain.label}</h4><ScoringNumber label="Domain cap" min={0} value={domain.cap} onChange={cap => onChange({ ...d, domains: d.domains.map(item => item.id === domain.id ? { ...item, cap } : item) })}/></div>)}</div></section>
    <section className="space-y-4"><h3 className="text-lg font-medium">Scoring rules</h3>{d.scoring.map((rule, index) => <section key={rule.id} id={`rule-scoring-${rule.id}`} className="space-y-4 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><h4 className="font-medium">{rule.label}</h4><p className="text-sm text-muted-foreground">{rule.kind === 'options' ? questions.find(question => question.id === rule.questionId)?.label : rule.kind === 'ranges' ? [...questions, ...d.calculations].find(input => input.id === rule.input.id)?.label : 'Conditional scoring'}</p></div><ScoringSelect label="Domain" value={rule.domainId} options={[{value:'unassigned',label:'Choose domain'}, ...domains.map(domain => ({ value: domain.id, label: domain.label }))]} onChange={domainId => patch(index, { ...rule, domainId })}/></div>
      {rule.kind === 'options' && <OptionsScoring definition={d} rule={rule} onChange={updated => patch(index, updated)}/>}
      {rule.kind === 'ranges' && <div className="space-y-3">{rule.bands.map((band, i) => <fieldset key={band.id} className="space-y-3 rounded-md bg-muted/30 p-3"><legend className="px-1 text-sm font-medium">Range {i + 1}</legend><RangeFields value={band} onChange={value => patch(index, { ...rule, bands: rule.bands.map((item, j) => i === j ? { ...item, ...value } : item) })}/><ScoringNumber label="Range points" value={band.points} onChange={points => patch(index, { ...rule, bands: rule.bands.map((item, j) => i === j ? { ...item, points: points ?? 0 } : item) })}/></fieldset>)}</div>}
      {rule.kind === 'condition' && <><p className="rounded-md bg-muted/30 p-3 text-sm">When {describeCondition(d, rule.when)}.</p>{rule.when.tests.map((test, testIndex) => typeof test.value === 'number' ? <ScoringNumber key={testIndex} label={`Condition threshold ${testIndex + 1}`} value={test.value} onChange={value => patch(index, { ...rule, when: { ...rule.when, tests: rule.when.tests.map((item, i) => i === testIndex ? { ...item, value: value ?? 0 } : item) } })}/> : null)}<div className="grid gap-3 sm:grid-cols-2"><ScoringNumber label="Points when matched" value={rule.points} onChange={points => patch(index, { ...rule, points: points ?? 0 })}/><ScoringNumber label="Points otherwise" value={rule.otherwise} onChange={otherwise => patch(index, { ...rule, otherwise: otherwise ?? 0 })}/></div></>}
    </section>)}</section>
    <section className="space-y-4"><h3 className="text-lg font-medium">Total score</h3><div className="grid items-end gap-3 sm:grid-cols-2"><p className="text-sm text-muted-foreground">{d.total.aggregation === 'sum' ? 'Add domain scores together' : 'Use the highest domain score'}; round to {d.total.precision} decimal places.</p><ScoringNumber label="Total cap" min={0} value={d.total.cap} onChange={cap => onChange({ ...d, total: { ...d.total, cap } })}/></div></section>
    <section className="space-y-4"><h3 className="text-lg font-medium">Classifications</h3><p className="text-sm text-muted-foreground">Define non-overlapping ranges covering every possible total score.</p>{d.classifications.map((item,index)=>{const uses=scoringReferences(d,'classification',item.id);return <div key={item.id} id={`rule-classifications-${item.id}`} className="space-y-3 rounded-lg border p-4"><ScoringField label="Classification name"><Input aria-label="Classification name" value={item.label} onChange={e=>onChange({...d,classifications:d.classifications.map((v,i)=>i===index?{...v,label:e.target.value}:v)})}/></ScoringField><RangeFields value={item} onChange={value=>onChange({...d,classifications:d.classifications.map((v,i)=>i===index?{...v,...value}:v)})}/><ScoringField label="Interpretation"><Input aria-label="Interpretation" value={item.interpretation} onChange={e=>onChange({...d,classifications:d.classifications.map((v,i)=>i===index?{...v,interpretation:e.target.value}:v)})}/></ScoringField><Button type="button" variant="outline" disabled={uses.length>0} onClick={()=>onChange({...d,classifications:d.classifications.filter((_,i)=>i!==index)})}>Remove classification</Button>{uses.length>0&&<p className="text-sm text-muted-foreground">Used by {uses.join(', ')}. Remove these references first.</p>}</div>})}<Button type="button" variant="outline" onClick={()=>onChange({...d,classifications:[...d.classifications,{id:newRuleId('classification'),label:'New classification',interpretation:'',min:null,max:null,minInclusive:true,maxInclusive:true,sources:[]}]})}>Add classification</Button></section>
  </fieldset>;
}

function OptionsScoring({ definition, rule, onChange }: {
  definition: RuleDefinition;
  rule: Extract<Score, { kind: 'options' }>;
  onChange: (rule: Extract<Score, { kind: 'options' }>) => void;
}) {
  const question = definition.sections.flatMap(section => section.questions).find(item => item.id === rule.questionId);
  const options = question?.options ?? [];
  const setPoints = (optionId: string, points: number | null) => {
    // An unanswered score is unresolved configuration, not an implicit zero.
    const configured = new Map(rule.points.map(item => [item.optionId, item.points]));
    if (points === null) configured.delete(optionId);
    else configured.set(optionId, points);
    onChange({ ...rule, points: options.flatMap(option => {
      const value = configured.get(option.id);
      return value === undefined ? [] : [{ optionId: option.id, points: value }];
    }) });
  };
  return <>
    <div className="grid gap-3 sm:grid-cols-2">{options.map(option => {
      const points = rule.points.find(item => item.optionId === option.id)?.points;
      return <div key={option.id} className="space-y-1"><ScoringNumber label={option.label} value={points ?? null} onChange={value => setPoints(option.id, value)}/>{points === undefined && <p className="text-sm text-muted-foreground">Not configured</p>}</div>;
    })}</div>
    <div className="grid items-end gap-3 sm:grid-cols-2">
      {question?.type === 'multi_select' ? <ScoringSelect label="Combine selected options" value={rule.aggregation} options={[{ value: 'sum', label: 'Add points together' }, { value: 'max', label: 'Use highest points' }]} onChange={value => onChange({ ...rule, aggregation: value as 'sum' | 'max' })}/> : <p className="text-sm text-muted-foreground">Use the points for the selected answer.</p>}
      <ScoringNumber label="Component cap" min={0} value={rule.cap} onChange={cap => onChange({ ...rule, cap })}/>
    </div>
  </>;
}
