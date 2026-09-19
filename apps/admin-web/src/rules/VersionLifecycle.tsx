import { FilePenLine, ClipboardCheck, ShieldCheck, Rocket } from 'lucide-react';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import type { RuleDetail } from './rule-api';

type AuditEntry = NonNullable<RuleDetail['audit']>[number];
const labels: Record<string, string> = { RULE_CREATED: 'Draft created', RULE_SAVED: 'Draft saved', RULE_VALIDATED: 'Checks passed', RULE_APPROVED: 'Version approved', RULE_ACTIVE: 'Version activated', RULE_RETIRED: 'Version retired', RULE_DEFAULT_SET: 'Made default', RULE_DEFAULT_REPLACED: 'Default replaced' };
const stages = [
  { state: 'DRAFT', label: 'Draft', action: 'RULE_CREATED', icon: FilePenLine },
  { state: 'VALIDATED', label: 'Checked', action: 'RULE_VALIDATED', icon: ClipboardCheck },
  { state: 'APPROVED', label: 'Approved', action: 'RULE_APPROVED', icon: ShieldCheck },
  { state: 'ACTIVE', label: 'Active', action: 'RULE_ACTIVE', icon: Rocket },
];
function EventDetails({ event }: { event?: AuditEntry }) {
  if (!event) return <span className="text-xs text-muted-foreground">No recorded details</span>;
  const date = new Date(event.at);
  return <div className="min-w-0 space-y-1 text-xs text-muted-foreground"><p className="break-words">{event.actorName || `Administrator ${event.actor}`}</p><time dateTime={event.at}>{Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></div>;
}
function StageIcon({ stage, current, completed, event }: { stage: typeof stages[number]; current: boolean; completed: boolean; event?: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const Icon = stage.icon;
  return <Tooltip open={open} onOpenChange={setOpen}><TooltipTrigger asChild><button type="button" aria-label={`${stage.label} details`} onClick={() => setOpen(true)} className={`relative z-10 mx-auto flex size-11 items-center justify-center rounded-full border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${current ? 'border-primary bg-primary text-primary-foreground' : completed ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}><Icon className="size-5" aria-hidden="true" /></button></TooltipTrigger><TooltipContent side="top" sideOffset={8} className="max-w-64"><p className="font-medium">{stage.label}{current ? ' · Current stage' : ''}</p>{completed && event ? <><p>{event.actorName || `Administrator ${event.actor}`}</p><p>{new Date(event.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })}</p></> : <p>{completed ? 'No recorded details' : 'Not completed'}</p>}</TooltipContent></Tooltip>;
}
export function VersionLifecycle({ record }: { record: RuleDetail }) {
  const history = [...(record.audit ?? [])].sort((a, b) => a.revision - b.revision || a.at.localeCompare(b.at));
  const latestSave = history.filter(event => event.action === 'RULE_SAVED').at(-1);
  const currentIndex = stages.findIndex(stage => stage.state === record.lifecycle);
  return <section aria-label="Version timeline" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Version timeline</h3><span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">Current: {record.lifecycle === 'RETIRED' ? 'Retired' : stages[currentIndex]?.label ?? record.lifecycle}</span></div>
    <TooltipProvider><ol className="grid grid-cols-4 gap-1 sm:gap-3" aria-label="Version stages">{stages.map((stage, index) => {
      const completed = record.lifecycle === 'RETIRED' ? history.some(event => event.action === stage.action) : index <= currentIndex;
      const current = index === currentIndex;
      const event = stage.state === 'DRAFT' ? latestSave ?? history.find(event => event.action === 'RULE_CREATED') : history.filter(event => event.action === stage.action && (!latestSave || event.revision > latestSave.revision)).at(-1);
      const date = event ? new Date(event.at) : null;
      return <li key={stage.state} aria-current={current ? 'step' : undefined} className="relative min-w-0 space-y-2 text-center">{index < stages.length - 1 && <span aria-hidden="true" className={`absolute left-1/2 top-5 h-px w-[calc(100%+0.75rem)] ${index < currentIndex ? 'bg-primary/40' : 'bg-border'}`} />}<StageIcon stage={stage} current={current} completed={completed} {...(event ? { event } : {})} /><p className={`text-xs sm:text-sm ${current ? 'font-semibold text-primary' : 'font-medium'}`}>{stage.label}</p>{completed && date && !Number.isNaN(date.getTime()) ? <time className="block text-[11px] text-muted-foreground sm:text-xs" dateTime={event!.at}>{date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</time> : <p className="text-[11px] text-muted-foreground">{completed ? 'Date unavailable' : 'Not completed'}</p>}</li>;
    })}</ol></TooltipProvider>
    <p className="text-xs text-muted-foreground">Hover, focus or tap a stage for details.</p>
    <details className="border-t pt-3"><summary className="cursor-pointer text-sm text-muted-foreground">Activity history</summary>{history.length ? <div className="mt-3"><p className="mb-3 text-xs text-muted-foreground">Times are shown in your local time zone.</p><ol className="space-y-3">{[...history].reverse().map(event => <li key={event.id} className="space-y-1 border-b pb-3 text-sm"><p className="font-medium">{labels[event.action] ?? event.action}</p><EventDetails event={event} /></li>)}</ol></div> : <p className="mt-2 text-sm text-muted-foreground">No activity records are available for this version.</p>}</details>
  </section>;
}
