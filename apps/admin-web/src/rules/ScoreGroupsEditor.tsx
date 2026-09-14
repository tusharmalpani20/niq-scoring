import type { RuleDefinition } from '@niq-scoring/contracts/rules';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ScoringNumber } from './scoring-controls';
import { scoringReferences } from './scoring-model';
import { newRuleId } from './questionnaire-model';

type Props = { definition: RuleDefinition; onChange: (definition: RuleDefinition) => void; disabled?: boolean };

export function ScoreGroupsEditor({ definition: d, onChange, disabled = false }: Props) {
  const groups = d.domains.filter(group => group.id !== 'unassigned');
  const unassigned = d.scoring.filter(rule => rule.domainId === 'unassigned');
  return <section aria-label="Score groups" className="space-y-4 rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-medium">Score groups</h3><Button type="button" variant="outline" disabled={disabled || d.domains.length >= 50} onClick={() => onChange({ ...d, domains: [...d.domains, { id: newRuleId('group'), label: 'New group', cap: null, sources: [] }] })}>Add group</Button></div>
    <p className="text-sm text-muted-foreground">Group scored fields and limit their combined points. Each field belongs to one group. A blank cap means no limit.</p>
    <fieldset disabled={disabled} className="min-w-0">
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3 font-medium">Group name</th><th className="p-3 font-medium">Included fields</th><th className="p-3 font-medium">Cap</th><th className="p-3 font-medium">Actions</th></tr></thead><tbody>
        {groups.map(group => {
          const selected = d.scoring.filter(rule => rule.domainId === group.id);
          const references = scoringReferences(d, 'domain', group.id);
          return <tr key={group.id} className="border-b align-top last:border-0" aria-label={`${group.label} group`}>
            <td className="min-w-40 p-3"><Input aria-label={`${group.label} group name`} value={group.label} onChange={e => onChange({ ...d, domains: d.domains.map(item => item.id === group.id ? { ...item, label: e.target.value } : item) })}/></td>
            <td className="min-w-64 p-3"><details><summary className="cursor-pointer py-2 text-primary">{selected.length} fields selected</summary><div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">{d.scoring.map(rule => {
              const owner = groups.find(item => item.id === rule.domainId);
              const elsewhere = !!owner && owner.id !== group.id;
              return <label key={rule.id} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={rule.domainId === group.id} disabled={disabled || elsewhere} onChange={e => onChange({ ...d, scoring: d.scoring.map(item => item.id === rule.id ? { ...item, domainId: e.target.checked ? group.id : 'unassigned' } : item) })}/><span>{rule.label}{elsewhere && <span className="text-muted-foreground"> — {owner.label}</span>}</span></label>;
            })}</div></details></td>
            <td className="min-w-28 p-3"><Input type="number" min={0} step="any" aria-label={`${group.label} cap`} placeholder="No cap" value={group.cap ?? ''} onChange={e => onChange({ ...d, domains: d.domains.map(item => item.id === group.id ? { ...item, cap: e.target.value === '' ? null : Number(e.target.value) } : item) })}/></td>
            <td className="p-3"><Button type="button" variant="ghost" disabled={disabled || references.length > 0} title={references.length ? 'Unassign fields and remove references before deleting this group.' : undefined} onClick={() => onChange({ ...d, domains: d.domains.filter(item => item.id !== group.id) })}>Remove group</Button></td>
          </tr>;
        })}
      </tbody></table></div>
      {unassigned.length > 0 && <p className="mt-4 text-sm text-muted-foreground">{unassigned.length} scoring fields still need a group.</p>}
      <div className="mt-5 max-w-xs border-t pt-4"><ScoringNumber label="Total cap" min={0} value={d.total.cap} onChange={cap => onChange({ ...d, total: { ...d.total, cap } })}/></div>
    </fieldset>
  </section>;
}
