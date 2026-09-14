import type { RuleDefinition } from '@niq-scoring/contracts/rules';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { newRuleId } from './questionnaire-model';
import { ScoringField, RangeFields } from './scoring-controls';
import { scoringReferences } from './scoring-model';

type Props = { definition: RuleDefinition; onChange: (definition: RuleDefinition) => void; disabled?: boolean };

export function RiskCategoriesEditor({ definition: d, onChange, disabled = false }: Props) {
  return <fieldset disabled={disabled} className="min-w-0 rounded-2xl border border-border/50 bg-card p-5 shadow-sm sm:p-6">
    <section className="space-y-4"><p className="text-sm text-muted-foreground">Define non-overlapping ranges covering every possible total score.</p>{d.classifications.map((item,index)=>{const uses=scoringReferences(d,'classification',item.id);return <div key={item.id} id={`rule-classifications-${item.id}`} className="space-y-3 rounded-lg border p-4"><ScoringField label="Classification name"><Input aria-label="Classification name" value={item.label} onChange={e=>onChange({...d,classifications:d.classifications.map((v,i)=>i===index?{...v,label:e.target.value}:v)})}/></ScoringField><RangeFields value={item} onChange={value=>onChange({...d,classifications:d.classifications.map((v,i)=>i===index?{...v,...value}:v)})}/><ScoringField label="Interpretation"><Input aria-label="Interpretation" value={item.interpretation} onChange={e=>onChange({...d,classifications:d.classifications.map((v,i)=>i===index?{...v,interpretation:e.target.value}:v)})}/></ScoringField><Button type="button" variant="outline" disabled={uses.length>0} onClick={()=>onChange({...d,classifications:d.classifications.filter((_,i)=>i!==index)})}>Remove classification</Button>{uses.length>0&&<p className="text-sm text-muted-foreground">Used by {uses.join(', ')}. Remove these references first.</p>}</div>})}<Button type="button" variant="outline" onClick={()=>onChange({...d,classifications:[...d.classifications,{id:newRuleId('classification'),label:'New classification',interpretation:'',min:null,max:null,minInclusive:true,maxInclusive:true,sources:[]}]})}>Add classification</Button></section>
  </fieldset>;
}
