import type { RuleDefinition, RuleRange } from '@niq-scoring/contracts/rules';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { newRuleId } from './questionnaire-model';
import { ScoringField } from './scoring-controls';
import { scoringReferences } from './scoring-model';

type Props = { definition: RuleDefinition; onChange: (definition: RuleDefinition) => void; disabled?: boolean };

function rangeDescription(range: RuleRange) {
  if (range.min === null && range.max === null) return 'All scores';
  if (range.min === null) return `${range.maxInclusive ? 'Up to and including' : 'Below'} ${range.max}`;
  if (range.max === null) return `${range.minInclusive ? 'At least' : 'More than'} ${range.min}`;
  if (range.minInclusive && range.maxInclusive) return `${range.min} to ${range.max}, including both`;
  return `${range.minInclusive ? 'At least' : 'More than'} ${range.min} and ${range.maxInclusive ? 'up to' : 'below'} ${range.max}`;
}

function ScoreBoundary({ side, value, inclusive, disabled, onChange }: { disabled: boolean; side: 'lower' | 'upper'; value: number | null; inclusive: boolean; onChange: (value: number | null, inclusive: boolean) => void }) {
  const lower = side === 'lower';
  const label = lower ? 'From score' : 'To score';
  return <ScoringField label={label}><div className="flex flex-wrap gap-2">
    <Select disabled={disabled} value={value === null ? 'any' : inclusive ? 'inclusive' : 'exclusive'} onValueChange={choice => onChange(choice === 'any' ? null : value ?? 0, choice !== 'exclusive')}>
      <SelectTrigger aria-label={`${label} rule`} className="min-w-0 flex-1"><SelectValue/></SelectTrigger>
      <SelectContent>
        <SelectItem value="any">{lower ? 'No lower limit' : 'No upper limit'}</SelectItem>
        <SelectItem value="inclusive">{lower ? 'At least' : 'Up to and including'}</SelectItem>
        <SelectItem value="exclusive">{lower ? 'More than' : 'Less than'}</SelectItem>
      </SelectContent>
    </Select>
    {value !== null && <Input className="w-24" type="number" step="any" aria-label={label} value={value} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value), inclusive)}/>}
  </div></ScoringField>;
}

export function RiskCategoriesEditor({ definition: d, onChange, disabled = false }: Props) {
  const patch = (id: string, value: Partial<RuleDefinition['classifications'][number]>) => onChange({ ...d, classifications: d.classifications.map(item => item.id === id ? { ...item, ...value } : item) });
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-2xl border border-border/50 bg-card p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Choose the risk label shown for each final score.</p><Button type="button" variant="outline" onClick={() => onChange({ ...d, classifications: [...d.classifications, { id: newRuleId('classification'), label: 'New category', interpretation: '', min: null, max: null, minInclusive: true, maxInclusive: true, sources: [] }] })}><Plus className="size-4"/>Add category</Button></div>
    {d.classifications.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No risk categories yet. Add a category to get started.</p>}
    {d.classifications.map(item => {
      const uses = scoringReferences(d, 'classification', item.id);
      return <section key={item.id} id={`rule-classifications-${item.id}`} aria-label={`${item.label} category`} className="space-y-4 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{rangeDescription(item)}</p><Button type="button" variant="ghost" size="icon" className="shrink-0 text-destructive" aria-label={`Remove ${item.label}`} title={uses.length ? `Used by ${uses.join(', ')}` : 'Remove category'} disabled={disabled || uses.length > 0} onClick={() => onChange({ ...d, classifications: d.classifications.filter(v => v.id !== item.id) })}><Trash2 className="size-4"/></Button></div>
        <div className="grid gap-4 sm:grid-cols-2"><ScoringField label="Category name"><Input aria-label="Category name" value={item.label} onChange={e => patch(item.id, { label: e.target.value })}/></ScoringField><ScoringField label="What it means"><Input aria-label="What it means" value={item.interpretation} onChange={e => patch(item.id, { interpretation: e.target.value })}/></ScoringField>
          <ScoreBoundary disabled={disabled} side="lower" value={item.min} inclusive={item.minInclusive} onChange={(min, minInclusive) => patch(item.id, { min, minInclusive })}/>
          <ScoreBoundary disabled={disabled} side="upper" value={item.max} inclusive={item.maxInclusive} onChange={(max, maxInclusive) => patch(item.id, { max, maxInclusive })}/>
        </div>
      </section>;
    })}
    <p className="text-sm text-muted-foreground">Each possible score must fit exactly one category. Ranges must not overlap or leave gaps.</p>
  </fieldset>;
}
