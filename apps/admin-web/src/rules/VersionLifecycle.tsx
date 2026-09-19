import { Check, Circle } from 'lucide-react';
import type { RuleDetail } from './rule-api';

type AuditEntry = NonNullable<RuleDetail['audit']>[number];
const labels: Record<string, string> = { RULE_CREATED: 'Draft created', RULE_SAVED: 'Draft saved', RULE_VALIDATED: 'Checks passed', RULE_APPROVED: 'Version approved', RULE_ACTIVE: 'Version activated', RULE_RETIRED: 'Version retired' };
const stages = [
  { state: 'DRAFT', label: 'Draft', action: 'RULE_CREATED' },
  { state: 'VALIDATED', label: 'Checked', action: 'RULE_VALIDATED' },
  { state: 'APPROVED', label: 'Approved', action: 'RULE_APPROVED' },
  { state: 'ACTIVE', label: 'Active', action: 'RULE_ACTIVE' },
];
function EventDetails({ event }: { event?: AuditEntry }) {
  if (!event) return <span className="text-xs text-muted-foreground">No recorded details</span>;
  const date = new Date(event.at);
  return <div className="min-w-0 space-y-1 text-xs text-muted-foreground"><p className="break-words">{event.actorName || `Administrator ${event.actor}`}</p><time dateTime={event.at}>{Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></div>;
}
export function VersionLifecycle({ record }: { record: RuleDetail }) {
  const history = [...(record.audit ?? [])].sort((a, b) => a.revision - b.revision || a.at.localeCompare(b.at));
  const latestSave = history.filter(event => event.action === 'RULE_SAVED').at(-1);
  const currentIndex = stages.findIndex(stage => stage.state === record.lifecycle);
  return <section aria-label="Version timeline" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Version timeline</h3><span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">Current: {record.lifecycle === 'RETIRED' ? 'Retired' : stages[currentIndex]?.label ?? record.lifecycle}</span></div>
    <ol className="grid gap-3 sm:grid-cols-4" aria-label="Version stages">{stages.map((stage, index) => {
      const completed = record.lifecycle === 'RETIRED' ? history.some(event => event.action === stage.action) : index <= currentIndex;
      const current = index === currentIndex;
      const event = stage.state === 'DRAFT' ? latestSave ?? history.find(event => event.action === 'RULE_CREATED') : history.filter(event => event.action === stage.action && (!latestSave || event.revision > latestSave.revision)).at(-1);
      return <li key={stage.state} aria-current={current ? 'step' : undefined} className={`min-w-0 space-y-2 border-t-2 pt-3 ${completed ? 'border-primary' : 'border-border'}`}><div className="flex items-center gap-2 text-sm font-medium">{completed ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}{stage.label}</div>{completed ? <EventDetails {...(event ? { event } : {})} /> : <p className="text-xs text-muted-foreground">Not completed</p>}</li>;
    })}</ol>
    <p className="text-xs text-muted-foreground">Times are shown in your local time zone. Editing and saving a checked draft means it must be checked again.</p>
    <details className="border-t pt-3"><summary className="cursor-pointer text-sm text-muted-foreground">Activity history</summary>{history.length ? <ol className="mt-3 space-y-3">{[...history].reverse().map(event => <li key={event.id} className="space-y-1 border-b pb-3 text-sm"><p className="font-medium">{labels[event.action] ?? event.action}</p><EventDetails event={event} /></li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No activity records are available for this version.</p>}</details>
  </section>;
}
