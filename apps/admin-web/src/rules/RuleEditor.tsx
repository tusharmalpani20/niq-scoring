import { useEffect, useMemo, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { isFixedRuleDefinition } from '@niq-scoring/contracts/fixed-profile';
import { ruleDefinitionSchema, type RuleDefinition } from '@niq-scoring/contracts/rules';
import { validateRuleDefinition } from '@niq-scoring/contracts/rule-validation';
import { request, message, ApiError } from '../api';
import { ErrorNotice } from '../shared';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '../components/ui/alert-dialog';
import { ScoringEditor } from './ScoringEditor';
import { descriptionText } from './editor-copy';
import type { RuleDetail } from './rule-api';

export function RuleEditor({ initial, onClose, onSaved }: { initial: RuleDetail; onClose: () => void; onSaved: () => void }) {
  const [record, setRecord] = useState(initial);
  const parse = (value: unknown) => { const result = ruleDefinitionSchema.safeParse(value); return result.success ? result.data : null; };
  const [definition, setDefinition] = useState<RuleDefinition | null>(() => parse(initial.definition));
  const saved = useMemo(() => parse(record.definition), [record.definition]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<Array<{ path?: unknown; message?: string }>>([]);
  const [confirm, setConfirm] = useState<'close' | 'reload' | null>(null);
  const dirty = definition !== null && JSON.stringify(definition) !== JSON.stringify(saved);
  const blocker = useBlocker(dirty || busy);
  const editable = definition !== null && isFixedRuleDefinition(record.definition) && ['DRAFT', 'VALIDATED'].includes(record.lifecycle);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, busy]);
  function update(next: RuleDefinition) { setDefinition(next); setNotice(''); setIssues([]); }
  function accept(next: RuleDetail) { setRecord(next); setDefinition(parse(next.definition)); onSaved(); }
  async function reload() {
    setBusy(true); setError('');
    try { accept(await request<RuleDetail>(`/admin/rules/${record.id}`)); setIssues([]); setNotice(''); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function save() {
    if (!definition) return;
    setError(''); setNotice(''); setIssues([]);
    const parsed = ruleDefinitionSchema.safeParse(definition);
    if (!parsed.success) { setIssues(parsed.error.issues); return; }
    const checks = validateRuleDefinition(parsed.data);
    const invalid = checks.filter(i => i.severity === 'error');
    if (invalid.length) { setIssues(invalid); return; }
    setBusy(true);
    try {
      accept(await request<RuleDetail>(`/admin/rules/${record.id}`, { revision: record.revision, definition: parsed.data }, 'PUT'));
      setNotice(checks.length ? 'Draft saved. Configuration is incomplete; this version is not ready for use.' : 'Draft saved.');
    } catch (cause) { setError(message(cause)); if (cause instanceof ApiError) setIssues(cause.issues.filter((item): item is { message: string } => item !== null && typeof item === 'object' && 'message' in item && typeof item.message === 'string')); }
    finally { setBusy(false); }
  }
  return <section className="min-w-0 space-y-6" aria-label="Rule version editor">
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={busy} onClick={onClose}>Back to versions</Button><div className="flex items-center gap-3 text-sm"><Badge variant="secondary">{record.lifecycle}</Badge><span className="text-muted-foreground">{dirty ? 'Unsaved changes' : `Revision ${record.revision}`}{!editable && ' · Read-only'}</span></div></div>
    <h2 className="text-xl font-semibold break-words">{record.version}</h2>
    {definition ? <>
      {!editable && <p className="text-sm text-muted-foreground">This version is read-only. Create a new version to change its scoring configuration.</p>}
      <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="rule-name">Name</Label><Input id="rule-name" value={definition.name} maxLength={80} onChange={e => update({ ...definition, name: e.target.value })}/></div><div className="space-y-2"><Label htmlFor="rule-description">Description</Label><Textarea id="rule-description" value={descriptionText(definition.description)} onChange={e => update({ ...definition, description: e.target.value })}/></div></fieldset>
      <h3 className="text-lg font-semibold">Scoring</h3>
      <ScoringEditor definition={definition} onChange={update} disabled={!editable || busy}/>
      <div className="flex items-center justify-between rounded-lg border p-4"><h3 className="font-medium">Interventions</h3><span className="text-sm text-muted-foreground">N/A — not finalized</span></div>
    </> : <p>This earlier definition can’t be edited here.</p>}
    <ErrorNotice error={error}/>{notice && <p role="status" className="text-sm">{notice}</p>}
    {issues.length > 0 && <ul aria-label="Configuration issues" className="space-y-2 rounded-lg border border-destructive/30 p-4">{issues.map((issue, index) => <li key={index} className="text-sm">{issue.message}</li>)}</ul>}
    <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background py-4"><Button variant="outline" disabled={busy} onClick={() => dirty ? setConfirm('reload') : void reload()}>Reload</Button>{editable && <Button disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save draft'}</Button>}</div>
    <AlertDialog open={confirm !== null || blocker.state === 'blocked'} onOpenChange={open => { if (!open) { setConfirm(null); if (blocker.state === 'blocked') blocker.reset(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Your unsaved edits will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { const action = confirm; setConfirm(null); if (blocker.state === 'blocked') { event.preventDefault(); blocker.proceed(); } else if (action === 'reload') void reload(); else onClose(); }}>Discard</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
