import { useEffect, useState } from "react";
import { useBlocker } from "react-router-dom";
import { ruleDefinitionSchema, type RuleDefinition } from "@niq-scoring/contracts/rules";
import { validateRuleDefinition } from "@niq-scoring/contracts/rule-validation";
import { request, message, ApiError } from "../api";
import { ErrorNotice } from "../shared";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "../components/ui/alert-dialog";
import { QuestionnaireEditor } from "./QuestionnaireEditor";
import { ScoringEditor } from "./ScoringEditor";
import { InterventionEditor } from "./InterventionEditor";
import { issueLocation } from "./issue-location";
import { SampleEditor } from "./SampleEditor";
import { RulePreview } from "./RulePreview";
import type { RuleDetail } from "./rule-api";

type Issue = { path?: string; message?: string };
export function RuleEditor({ initial, onClose, onSaved }: { initial: RuleDetail; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState("details");
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!focusTarget) return;
    const element = document.getElementById(focusTarget);
    if (element) {
      if (element instanceof HTMLDetailsElement) element.open = true;
      element.scrollIntoView({ block: "center" });
      const input = element.querySelector<HTMLElement>("input, select, textarea, button, summary");
      input?.focus({ preventScroll: true });
    }
    setFocusTarget(null);
  }, [tab, focusTarget]);
  const [record, setRecord] = useState(initial);
  const [definition, setDefinition] = useState<RuleDefinition | null>(() => { const parsed = ruleDefinitionSchema.safeParse(initial.definition); return parsed.success ? parsed.data : null; });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [confirm, setConfirm] = useState<"discard" | "reload" | "approve" | "activate" | "retire" | null>(null);
  const dirty = definition !== null && JSON.stringify(definition) !== JSON.stringify(record.definition);
  const blocker = useBlocker(dirty);
  const editable = definition !== null && ["DRAFT", "VALIDATED"].includes(record.lifecycle);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  function update(next: RuleDefinition) { setDefinition(next); setIssues([]); setNotice(""); }
  function accept(next: RuleDetail) { setRecord(next); const parsed = ruleDefinitionSchema.safeParse(next.definition); setDefinition(parsed.success ? parsed.data : null); onSaved(); }
  async function perform(action: "save" | "reload" | "check" | "validate" | "approve" | "activate" | "retire") {
    setBusy(true); setError(""); setNotice(""); setIssues([]);
    try {
      if (action === "save") {
        if (!definition) return;
        const parsed = ruleDefinitionSchema.safeParse(definition);
        if (!parsed.success) { setIssues(parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message }))); return; }
        const invalid = validateRuleDefinition(parsed.data).filter(i => i.severity === "error");
        if (invalid.length) { setIssues(invalid); return; }
        accept(await request<RuleDetail>(`/admin/rules/${record.id}`, { revision: record.revision, definition }, "PUT")); setNotice("Draft saved.");
      } else if (action === "reload") accept(await request<RuleDetail>(`/admin/rules/${record.id}`));
      else if (action === "check") {
        const result = await request<{ issues: Issue[] }>(`/admin/rules/${record.id}/check`, { revision: record.revision });
        setIssues(result.issues); setNotice(result.issues.length ? `${result.issues.length} issues need attention.` : "All definition and sample checks passed.");
      } else {
        accept(await request<RuleDetail>(`/admin/rules/${record.id}/${action}`, { revision: record.revision })); setNotice(`Version ${action === "validate" ? "validated" : action === "approve" ? "approved" : action === "activate" ? "activated" : "retired"}.`);
      }
    } catch (cause) { setError(message(cause)); if (cause instanceof ApiError) setIssues(cause.issues as Issue[]); }
    finally { setBusy(false); }
  }
  return <><Dialog open onOpenChange={open => { if (!open && !busy) { if (dirty) setConfirm("discard"); else onClose(); } }}><DialogContent className="flex max-h-[94dvh] flex-col overflow-hidden sm:max-w-6xl"><DialogHeader><DialogTitle className="break-words">{record.version}</DialogTitle><DialogDescription><Badge variant="secondary">{record.lifecycle}</Badge><span className="ml-3">{dirty ? "Unsaved changes" : `Revision ${record.revision}`}</span>{!editable && " · Read-only"}</DialogDescription></DialogHeader>
    <div className="min-h-0 overflow-y-auto pr-1">
    {definition ? <Tabs value={tab} onValueChange={setTab} className="gap-5"><TabsList variant="line" className="max-w-full overflow-x-auto" aria-label="Rule editor sections">{["details", "questionnaire", "scoring", "interventions", "preview", "validation"].map(tab => <TabsTrigger value={tab} key={tab}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</TabsTrigger>)}</TabsList>
      <TabsContent id="rule-tab-details" value="details"><fieldset disabled={!editable || busy} className="space-y-4"><div className="space-y-2"><Label htmlFor="rule-name">Version name</Label><Input id="rule-name" value={definition.name} maxLength={80} onChange={e => update({ ...definition, name: e.target.value })} /></div><div className="space-y-2"><Label htmlFor="rule-description">Description</Label><Textarea id="rule-description" value={definition.description} onChange={e => update({ ...definition, description: e.target.value })} /></div>
      {definition.issues.length > 0 && <section className="space-y-3"><h3 className="font-medium">Source decisions</h3>{definition.issues.map((issue, index) => <div key={issue.id} id={`rule-issues-${issue.id}`} className="space-y-2 rounded-lg border p-4"><p>{issue.message}</p><p className="text-xs text-muted-foreground">{issue.sources.map(source => `${source.document}: ${source.location}`).join(" · ")}</p><Label className="flex gap-2"><input type="checkbox" checked={issue.resolved} onChange={e => update({ ...definition, issues: definition.issues.map((item, i) => i === index ? { ...item, resolved: e.target.checked } : item) })} />Decision resolved</Label><Label htmlFor={`resolution-${issue.id}`}>Resolution and supporting evidence</Label><Textarea id={`resolution-${issue.id}`} value={issue.resolution} onChange={e => update({ ...definition, issues: definition.issues.map((item, i) => i === index ? { ...item, resolution: e.target.value } : item) })} /></div>)}</section>}</fieldset></TabsContent>
      <TabsContent id="rule-tab-questionnaire" value="questionnaire"><QuestionnaireEditor definition={definition} onChange={update} disabled={!editable || busy} /></TabsContent>
      <TabsContent id="rule-tab-scoring" value="scoring"><ScoringEditor definition={definition} onChange={update} disabled={!editable || busy} /></TabsContent>
      <TabsContent id="rule-tab-interventions" value="interventions"><InterventionEditor definition={definition} onChange={update} disabled={!editable || busy} /></TabsContent>
      <TabsContent id="rule-tab-preview" value="preview" forceMount className="data-[state=inactive]:hidden"><RulePreview definition={definition} ruleId={record.id} revision={record.revision} dirty={dirty} onChange={update} editable={editable && !busy} /></TabsContent>
      <TabsContent id="rule-tab-validation" value="validation"><p className="mb-4 text-sm text-muted-foreground">Save your draft before checking its definition and sample expectations. Unresolved clinical decisions block validation.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || dirty} onClick={() => void perform("check")}>Check definition and samples</Button>{editable && <Button disabled={busy || dirty} onClick={() => void perform("validate")}>Validate version</Button>}{record.lifecycle === "VALIDATED" && <Button disabled={busy || dirty} onClick={() => setConfirm("approve")}>Approve version</Button>}{record.lifecycle === "APPROVED" && <Button disabled={busy} onClick={() => setConfirm("activate")}>Activate version</Button>}{["APPROVED", "ACTIVE"].includes(record.lifecycle) && <Button variant="outline" disabled={busy} onClick={() => setConfirm("retire")}>Retire version</Button>}</div><div className="mt-6"><SampleEditor definition={definition} onChange={update} disabled={!editable || busy} /></div></TabsContent>
    </Tabs> : <p>This legacy definition is read-only. Create a new draft to use the rule editor.</p>}
    <div className="mt-4 space-y-3"><ErrorNotice error={error} />{notice && <p role="status" className="text-sm">{notice}</p>}{issues.length > 0 && <ul className="space-y-2 rounded-lg border border-destructive/30 p-4" aria-label="Validation issues">{issues.map((issue, index) => { const location = definition ? issueLocation(definition, issue.path) : null; return <li key={index} className="text-sm">{location && <Button variant="link" className="h-auto p-0 mr-2" onClick={() => { setTab(location.tab); setFocusTarget(location.id); }}>{location.label}</Button>}{issue.message}</li>; })}</ul>}</div>
    </div><div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button variant="outline" disabled={busy} onClick={() => dirty ? setConfirm("reload") : void perform("reload")}>Reload</Button><Button variant="outline" disabled={busy} onClick={() => dirty ? setConfirm("discard") : onClose()}>{editable ? "Cancel" : "Close"}</Button>{editable && <Button disabled={busy || !dirty} onClick={() => void perform("save")}>{busy ? "Working…" : "Save draft"}</Button>}</div>
  </DialogContent></Dialog>
  <AlertDialog open={confirm !== null || blocker.state === "blocked"} onOpenChange={open => { if (!open) { setConfirm(null); if (blocker.state === "blocked") blocker.reset(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm === "discard" || confirm === "reload" || blocker.state === "blocked" ? "Discard unsaved changes?" : `${confirm ? confirm.charAt(0).toUpperCase() + confirm.slice(1) : ""} this version?`}</AlertDialogTitle><AlertDialogDescription>{confirm === "discard" || confirm === "reload" || blocker.state === "blocked" ? "Your unsaved edits will be lost." : confirm === "approve" ? "Approval makes this definition immutable and eligible for clinical use. Confirm that its clinical content has been reviewed." : confirm === "retire" ? "This version will no longer be eligible for new assessments. Historical evidence is retained." : "This marks the approved version as active."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{confirm === "discard" || confirm === "reload" || blocker.state === "blocked" ? "Keep editing" : "Cancel"}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = confirm; setConfirm(null); if (blocker.state === "blocked") { blocker.proceed(); return; } if (action === "discard") onClose(); else if (action) void perform(action); }}>{confirm === "discard" || confirm === "reload" || blocker.state === "blocked" ? "Discard" : "Confirm"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
