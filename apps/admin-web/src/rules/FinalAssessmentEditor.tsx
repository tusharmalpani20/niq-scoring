import type { Overview } from "../Operations";
import { DefaultVersionImpact } from "./DefaultVersionImpact";
import { VersionLifecycle } from "./VersionLifecycle";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { ChevronDown, CircleCheck, CircleAlert } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useBlocker } from "react-router-dom";
import { finalAssessmentDefinitionSchema, type FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { isFixedFinalAssessmentDefinition, validateFinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment-validation";
import { request, message, ApiError } from "../api";
import { ErrorNotice } from "../shared";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { NativeSelect } from "../components/ui/native-select";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "../components/ui/alert-dialog";
import { upgradeFinalAssessmentDefinition, withDefaultRiskCategoryColors } from "@niq-scoring/contracts/final-assessment-template";
import { SimpleRiskEditor, FaceScanEditor } from "./ScoreRangeEditors";
import { newRuleId } from "./questionnaire-model";
import type { RuleDetail } from "./rule-api";

type Tab = "details" | "scoring" | "risk categories" | "face scan" | "interventions";
type FinalField = FinalAssessmentDefinition["sections"][number]["fields"][number];
type OptionField = Extract<FinalField, { kind: "select" | "multi_select" | "yes_no" }>;
type Issue = { path?: unknown; message?: string };

const typeLabel: Record<FinalField["kind"], string> = {
  select: "Select", multi_select: "Multi-select", yes_no: "Yes / No", conditional: "Conditional", count: "Count", calculated: "Calculated", derived: "Derived",
};

function parse(value: unknown) {
  const result = finalAssessmentDefinitionSchema.safeParse(value);
  return result.success ? result.data : null;
}

function editableDefinition(record: RuleDetail) {
  const definition = parse(record.definition);
  return definition && ["DRAFT", "VALIDATED"].includes(record.lifecycle) ? withDefaultRiskCategoryColors(definition) : definition;
}

function scoreSummary(field: FinalField) {
  if (field.kind === "calculated") return `${field.scoring.bands.length} ranges configured`;
  if (field.kind === "derived") return `${field.scoring.outcomes.length} scores configured`;
  if (field.kind === "count") return `${field.scoring.pointsPerCount} point per surgery`;
  if (field.kind === "conditional") return "Treatment scores";
  return `${field.options.length} options configured`;
}

function rangeText(range: { min: number | null; max: number | null; minInclusive: boolean; maxInclusive: boolean }) {
  if (range.min === null) return range.max === null ? "Any percentage" : `${range.maxInclusive ? "Up to" : "Below"} ${range.max}%`;
  if (range.max === null) return `${range.minInclusive ? "From" : "Above"} ${range.min}%`;
  if (range.minInclusive && range.maxInclusive) return `${range.min}–${range.max}%`;
  return `${range.minInclusive ? "From" : "Above"} ${range.min}% and ${range.maxInclusive ? "up to" : "below"} ${range.max}%`;
}

function PointInput({ label, value, draft, disabled, onDraft, onCommit, hideLabel = false }: { hideLabel?: boolean; label: string; value: number; draft: string | undefined; disabled: boolean; onDraft: (value: string) => void; onCommit: (value: number) => void }) {
  const invalid = draft !== undefined && (draft === "" || !Number.isFinite(Number(draft)) || Number(draft) < 0 || !Number.isInteger(Number(draft)));
  return <label className={`grid min-w-0 items-center gap-x-3 gap-y-1 text-sm ${hideLabel ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_5rem]"}`}><span className={hideLabel ? "sr-only" : "font-normal"}>{label}</span><Input className="h-9 w-20 shadow-none" type="number" min={0} step="1" disabled={disabled} aria-invalid={invalid} aria-label={label.toLowerCase().includes("points") ? label : `${label} points`} value={draft ?? String(value)} onChange={event => { const next = event.target.value; onDraft(next); if (next !== "") { const number = Number(next); if (Number.isFinite(number) && number >= 0 && Number.isInteger(number)) onCommit(number); } }} />{invalid && <span role="alert" className="col-span-full text-xs text-destructive">Enter a whole number of 0 or more.</span>}</label>;
}

const DraftContext = createContext<{ drafts: Record<string, string>; setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>> }>({ drafts: {}, setDrafts: () => {} });
function invalidDraft(key: string, value: string) {
  if (key.startsWith("risk-color:")) return !/^#[0-9a-fA-F]{6}$/.test(value);
  return value.trim() === "" || !Number.isFinite(Number(value)) || ((key.startsWith("face-threshold:") || key.startsWith("face-range:")) ? Number(value) < 0 || Number(value) > 100 : !key.startsWith("range:") && (Number(value) < 0 || !Number.isSafeInteger(Number(value))));
}
function BoundaryInput({ id, label, value, inclusive, disabled, onChange }: { id: string; label: string; value: number | null; inclusive: boolean; disabled: boolean; onChange: (value: number | null, inclusive: boolean) => void }) {
  const { drafts, setDrafts } = useContext(DraftContext);
  const key = `range:${id}`;
  const mode = value === null ? "none" : inclusive ? "inclusive" : "exclusive";
  const invalid = drafts[key] !== undefined && invalidDraft(key, drafts[key]!);
  return <div className="min-w-0 space-y-2 text-sm"><label className="font-medium" htmlFor={id}>{label}</label><NativeSelect disabled={disabled} aria-label={`${label} comparison`} value={mode} onChange={event => { const next = event.target.value; setDrafts(current => { const copy = { ...current }; delete copy[key]; return copy; }); onChange(next === "none" ? null : value ?? 0, next !== "exclusive"); }}><option value="none">No limit</option><option value="inclusive">Include this number</option><option value="exclusive">Exclude this number</option></NativeSelect>{value !== null && <Input id={id} type="number" step="any" disabled={disabled} aria-invalid={invalid} value={drafts[key] ?? value} onChange={event => { const raw = event.target.value; setDrafts(current => ({ ...current, [key]: raw })); if (raw.trim() !== "" && Number.isFinite(Number(raw))) onChange(Number(raw), inclusive); }} />}{invalid && <p role="alert" className="text-xs text-destructive">Enter a number or choose No limit.</p>}</div>;
}

export function FinalAssessmentEditor({ initial, onClose, onSaved }: { initial: RuleDetail; onClose: () => void; onSaved: (record: RuleDetail) => void }) {
  const [record, setRecord] = useState(initial);
  const [definition, setDefinition] = useState(() => editableDefinition(initial));
  const saved = useMemo(() => parse(record.definition), [record.definition]);
  const [tab, setTab] = useState<Tab>("details");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [pointDrafts, setPointDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmationAction, setConfirmationAction] = useState<"approve" | "activate" | "set-default" | "retire" | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [defaultImpact, setDefaultImpact] = useState<Overview | null>(null);
  const [impactError, setImpactError] = useState("");
  const [impactRetry, setImpactRetry] = useState(0);
  const needsImpact = confirmationAction === "set-default" || confirmationAction === "activate" && makeDefault;
  useEffect(() => {
    let cancelled = false;
    setDefaultImpact(null);
    setImpactError("");
    if (needsImpact) void request<Overview>("/admin/overview").then(data => {
      if (!cancelled) setDefaultImpact(data);
    }).catch(cause => { if (!cancelled) setImpactError(message(cause)); });
    return () => { cancelled = true; };
  }, [needsImpact, impactRetry]);

  const [result, setResult] = useState<{ action: "validate" | "approve" | "activate" | "set-default" | "retire"; success: boolean; detail: string; reasons?: string[] } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [nameError, setNameError] = useState("");
  const [confirm, setConfirm] = useState<"close" | "reload" | null>(null);
  const dirty = definition !== null && (JSON.stringify(definition) !== JSON.stringify(saved) || Object.entries(pointDrafts).some(([key, value]) => invalidDraft(key, value)));
  const blocker = useBlocker(dirty || busy);
  const editable = definition !== null && isFixedFinalAssessmentDefinition(record.definition) && ["DRAFT", "VALIDATED"].includes(record.lifecycle);

  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy]);

  function update(next: FinalAssessmentDefinition) { setDefinition(next); setNotice(""); setIssues([]); setNameError(""); }
  function showIssues(next: Issue[]) {
    const nameIssue = next.find(issue => (Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path ?? "")) === "name");
    setNameError(nameIssue ? "Enter a rule name." : "");
    // Range editors already display these errors next to their controls.
    setIssues(next.filter(issue => {
      const path = Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path ?? "");
      if (path === "name") return false;
      const inlineRisk = definition?.provisional.status === "CLIENT_CONFIRMED" && (path.startsWith("riskCategories") || path.startsWith("risk:") || path.startsWith("risk-color:"));
      return !path.startsWith("face") && !inlineRisk;
    }));
    const issuePath = next[0]?.path;
    const path = Array.isArray(issuePath) ? issuePath.join(".") : String(issuePath ?? "");
    if (path === "name") setTab("details");
    const draftField = definition?.sections.flatMap((section, sectionIndex) => section.fields.map(field => ({ field, sectionIndex }))).find(({ field }) => path.startsWith(`${field.id}:`) || (field.kind === "calculated" && field.scoring.bands.some(band => path.startsWith(`range:${band.id}-`))));
    if (draftField) { setTab("scoring"); setSectionIndex(draftField.sectionIndex); setExpanded(current => [...new Set([...current, draftField.field.id])]); }
    if (path.startsWith("face") ) setTab("face scan");
    if (path.startsWith("risk:") || path.startsWith("risk-color:") || path.startsWith("range:") && !draftField) setTab("risk categories");
    const sectionMatch = path.match(/^sections\.(\d+)/);
    if (sectionMatch) { setTab("scoring"); setSectionIndex(Number(sectionMatch[1])); const fieldIndex = path.match(/fields\.(\d+)/)?.[1]; const field = definition?.sections[Number(sectionMatch[1])]?.fields[Number(fieldIndex)]; if (field) setExpanded(current => [...new Set([...current, field.id])]); }
    else if (path.startsWith("riskCategories")) setTab("risk categories");
    requestAnimationFrame(() => {
      if (path === "name") {
        const input = document.getElementById("final-rule-name");
        input?.focus();
        input?.scrollIntoView({ block: "center" });
        return;
      }
      if (path.startsWith("riskCategories") || path.startsWith("risk:")) {
        const categoryIndex = Number(path.match(/^riskCategories\.(\d+)\.label$/)?.[1]);
        const categoryId = definition?.riskCategories[categoryIndex]?.id;
        const nameInput = categoryId ? document.getElementById(`risk-category-name-${categoryId}`) : null;
        if (nameInput) {
          nameInput.focus();
          nameInput.scrollIntoView({ block: "center" });
          return;
        }
        const row = document.querySelector<HTMLElement>('[role="group"][aria-invalid="true"][aria-label^="Risk category"]');
        if (row) {
          row.focus();
          row.scrollIntoView({ block: "center" });
          return;
        }
      }
      if (path.startsWith("face")) {
        const row = document.querySelector<HTMLElement>('[role="group"][aria-invalid="true"][aria-label^="Vital IQ range"]');
        if (row) {
          row.focus();
          row.scrollIntoView({ block: "center" });
          return;
        }
      }
      const rangeErrors = document.querySelector<HTMLElement>('[data-state="active"] [aria-label="Range errors"]');
      if (rangeErrors) { rangeErrors.tabIndex = -1; rangeErrors.focus(); }
      else document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
    });
  }
  function patchField(id: string, change: (field: FinalField) => FinalField) {
    if (!definition) return;
    update({ ...definition, sections: definition.sections.map(section => ({ ...section, fields: section.fields.map(field => field.id === id ? change(field) : field) })) });
  }
  function accept(next: RuleDetail) { setRecord(next); setDefinition(editableDefinition(next)); setPointDrafts({}); setNameError(""); onSaved(next); }
  async function reload() {
    setBusy(true); setError("");
    try { accept(await request<RuleDetail>(`/admin/rules/${record.id}`)); setIssues([]); setNotice(""); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function transition(action: "validate" | "approve" | "activate" | "set-default" | "retire") {
    if (dirty || busy || definition?.provisional.status !== "CLIENT_CONFIRMED" || (action === "set-default" || action === "activate" && makeDefault) && !defaultImpact) return;
    setBusy(true); setError(""); setNotice(""); setIssues([]);
    try {
      accept(await request<RuleDetail>(`/admin/rules/${record.id}/${action}`, { revision: record.revision, ...(action === "activate" ? { makeDefault } : {}) }));
      setConfirmationAction(null);
      setMakeDefault(false);
      setResult({ action, success: true, detail: action === "retire" ? "This version is retired. Existing assessments keep their rules and history." : action === "validate" ? "This version is ready for approval. If you make changes, check the rules again." : action === "approve" ? "Scoring rules are now locked. Activate this version to use it in Deployments." : action === "set-default" || makeDefault ? "Deployments following the default will use this version for new assessments. Existing assessments keep their original version." : "You can now assign this version in Deployments." });
    } catch (cause) { setConfirmationAction(null); setResult({ action, success: false, detail: message(cause), reasons: cause instanceof ApiError ? [...new Set(cause.issues.flatMap(issue => issue && typeof issue === "object" && "message" in issue && typeof issue.message === "string" ? [issue.message] : []))] : [] }); if (cause instanceof ApiError) showIssues(cause.issues.filter(issue => issue !== null && typeof issue === "object") as Issue[]); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!definition) return;
    setError(""); setNotice(""); setIssues([]);
    if (!definition.name.trim()) { showIssues([{ path: "name", message: "Enter a rule name." }]); return; }
    const draftIssue = Object.entries(pointDrafts).find(([key, value]) => invalidDraft(key, value));
    if (draftIssue) { showIssues([{ path: draftIssue[0], message: draftIssue[0].startsWith("risk-color:") ? "Enter a six-digit hex color, such as #2563EB." : "Enter valid ranges and whole-number points of 0 or more." }]); return; }
    const parsed = finalAssessmentDefinitionSchema.safeParse(definition);
    if (!parsed.success) { showIssues(parsed.error.issues); return; }
    const checks = validateFinalAssessmentDefinition(parsed.data, { requireRiskCategoryColors: true });
    const invalid = checks.filter(issue => issue.severity === "error" || issue.path.startsWith("riskCategories"));
    if (invalid.length) { showIssues(invalid); return; }
    setBusy(true);
    try { accept(await request<RuleDetail>(`/admin/rules/${record.id}`, { revision: record.revision, definition: parsed.data }, "PUT")); setNotice("Draft saved."); }
    catch (cause) { setError(message(cause)); if (cause instanceof ApiError) showIssues(cause.issues.filter(issue => issue !== null && typeof issue === "object") as Issue[]); }
    finally { setBusy(false); }
  }

  if (!definition) return <section className="space-y-5 pt-6"><ErrorNotice error="This final assessment definition could not be read." /></section>;
  const section = definition.sections[sectionIndex] ?? definition.sections[0]!;
  const close = () => { if (busy) return; if (dirty) setConfirm("close"); else onClose(); };
  const discardAction = (event: React.MouseEvent) => { const action = confirm; setConfirm(null); if (blocker.state === "blocked") { event.preventDefault(); blocker.proceed(); } else if (action === "reload") void reload(); else onClose(); };
  return <DraftContext.Provider value={{ drafts: pointDrafts, setDrafts: setPointDrafts }}><section className="min-w-0 space-y-6 pt-6" aria-label="Final assessment version editor">
    <header className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm"><Button variant="link" className="h-auto shrink-0 p-0 font-normal" aria-label="Back to rules" disabled={busy} onClick={close}>Rules</Button><span aria-hidden="true" className="text-muted-foreground">/</span><span aria-current="page" className="truncate text-muted-foreground">{record.version}</span></nav>
      <div className="flex flex-wrap items-center gap-3"><h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{record.version}</h1><Badge variant="secondary" className="gap-1.5 rounded-full px-2.5 py-1"><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{record.lifecycle.charAt(0) + record.lifecycle.slice(1).toLowerCase()}</Badge>{!editable && <span className="text-sm text-muted-foreground">Read-only</span>}</div>
    </header>
    {definition.provisional.status === "DEVELOPMENT_PLACEHOLDER" && <div className="space-y-3 rounded-xl border bg-card p-4 text-sm"><p>This draft uses the earlier scoring settings. Apply the client-confirmed rules before approval.</p>{editable && <Button disabled={busy} variant="outline" onClick={() => { update(upgradeFinalAssessmentDefinition(definition)); setPointDrafts({}); }}>Apply confirmed rules</Button>}<p className="text-muted-foreground">Updates weight-loss ranges and risk categories. Save the draft to keep these changes.</p></div>}
    <Tabs value={tab} onValueChange={value => setTab(value as Tab)} className="gap-5">
      <TabsList variant="line" aria-label="Rule sections" className="group-data-[orientation=horizontal]/tabs:h-auto h-auto min-h-11 w-full flex-wrap justify-start gap-x-6 gap-y-1 rounded-none border-b p-0">
        {(["details", "face scan", "scoring", "risk categories", "interventions"] as Tab[]).map(item => <TabsTrigger key={item} value={item} className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">{item === "face scan" ? "Vital IQ" : item.charAt(0).toUpperCase() + item.slice(1)}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="details"><div className="grid gap-5"><section className="rounded-2xl bg-card p-5 shadow-sm sm:p-6"><h2 className="mb-5 border-b pb-4 text-lg font-medium">Rule details</h2><fieldset disabled={!editable || busy} className="space-y-3"><div className="space-y-2 text-sm"><Label htmlFor="final-rule-name">Name<span aria-hidden="true" className="ml-1 text-destructive">*</span></Label><Input id="final-rule-name" aria-label="Name" aria-required="true" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "final-rule-name-error" : undefined} value={definition.name} maxLength={80} onChange={event => update({ ...definition, name: event.target.value })} />{nameError && <p id="final-rule-name-error" role="alert" className="text-sm text-destructive">{nameError}</p>}</div><label className="block space-y-2 text-sm"><Label htmlFor="final-rule-description">Description</Label><Textarea id="final-rule-description" value={definition.description} onChange={event => update({ ...definition, description: event.target.value })} /></label></fieldset></section><section className="rounded-2xl bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-medium">Rule status</h2><p className="mt-1 text-sm text-muted-foreground">NIQ final assessment v2</p></div><div className="flex gap-2">{record.isDefault && <Badge>Default</Badge>}<Badge variant="secondary">{record.lifecycle === "ACTIVE" ? "Active" : record.lifecycle === "APPROVED" ? "Approved" : record.lifecycle === "VALIDATED" ? "Checked" : record.lifecycle === "RETIRED" ? "Retired" : "Draft"}</Badge></div></div>{definition.provisional.status === "CLIENT_CONFIRMED" && ["DRAFT", "VALIDATED", "APPROVED"].includes(record.lifecycle) && <div className="mt-5 space-y-3 border-t pt-4"><p className="text-sm text-muted-foreground">{dirty ? "Save your changes before continuing." : record.lifecycle === "DRAFT" ? "Check the scoring rules for errors before approval." : record.lifecycle === "VALIDATED" ? "Ready for approval. Approval locks the scoring rules." : "Ready to activate. Once active, you can assign it in Deployments."}</p><Button disabled={dirty || busy} onClick={() => record.lifecycle === "DRAFT" ? void transition("validate") : setConfirmationAction(record.lifecycle === "VALIDATED" ? "approve" : "activate")}>{record.lifecycle === "DRAFT" ? "Check rules" : record.lifecycle === "VALIDATED" ? "Approve version" : "Activate version"}</Button></div>}{record.lifecycle === "ACTIVE" && <div className="mt-4 space-y-3"><p className="text-sm text-muted-foreground">{record.isDefault ? "Deployments following the default use this version for new assessments." : "Ready to use. Assign this version from Deployments or make it the default."}</p>{!record.isDefault && <Button disabled={busy} onClick={() => setConfirmationAction("set-default")}>Make default</Button>}</div>}{record.lifecycle === "RETIRED" && <p className="mt-4 text-sm text-muted-foreground">This version is retired. View its activity history below.</p>}<div className="mt-5 border-t pt-5"><VersionLifecycle record={record} /></div>{["APPROVED", "ACTIVE"].includes(record.lifecycle) && <div className="mt-5 space-y-2 border-t pt-4"><Button variant="outline" className="text-destructive" disabled={busy || record.isDefault} onClick={() => setConfirmationAction("retire")}>Retire version</Button><p className="text-sm text-muted-foreground">{record.isDefault ? "To retire this default, open another active version and choose Make default first." : "Retire this version when it should no longer be used for new assessments."}</p></div>}</section></div></TabsContent>
      <TabsContent value="scoring" forceMount className="min-w-0 data-[state=inactive]:hidden"><div className="min-w-0 space-y-5"><nav aria-label="Scoring sections" className="flex flex-wrap justify-start gap-2">{definition.sections.map((item, index) => <button key={item.id} type="button" className={`flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${index === sectionIndex ? "border-primary/50 bg-primary/10 font-medium text-primary" : "border-border bg-card hover:bg-muted/60"}`} aria-current={index === sectionIndex ? "page" : undefined} onClick={() => setSectionIndex(index)}><span>{item.title}</span><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{item.fields.length}</span></button>)}</nav><section className="min-w-0 space-y-4"><h2 className="text-xl font-semibold">{section.title}</h2><div className="min-w-0 space-y-3">{section.fields.map(field => <FieldRow key={field.id} field={field} expanded={expanded.includes(field.id)} onToggle={() => setExpanded(current => current.includes(field.id) ? current.filter(id => id !== field.id) : [...current, field.id])} definition={definition} disabled={!editable || busy} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} patchField={patchField} />)}</div></section></div></TabsContent>
      <TabsContent value="risk categories">{definition.provisional.status === "CLIENT_CONFIRMED" ? <SimpleRiskEditor definition={definition} disabled={!editable || busy} onChange={update} drafts={pointDrafts} setDrafts={setPointDrafts} /> : <RiskEditor definition={definition} disabled={!editable || busy} onChange={update} />}</TabsContent>
      <TabsContent value="face scan"><FaceScanEditor definition={definition} disabled={!editable || busy} onChange={update} drafts={pointDrafts} setDrafts={setPointDrafts} /></TabsContent>
      <TabsContent value="interventions"><section className="rounded-2xl bg-card p-6 shadow-sm"><h2 className="font-medium">Interventions</h2><p className="mt-2 text-sm text-muted-foreground">N/A — not yet configured.</p></section></TabsContent>
    </Tabs>
    <ErrorNotice error={error} />{notice && <p role="status" className="text-sm">{notice}</p>}{issues.length > 0 && <ul aria-label="Configuration issues" className="space-y-2 rounded-lg border border-destructive/30 p-4">{issues.map((issue, index) => <li key={index} className="text-sm">{issue.message ?? "Review this configuration."}</li>)}</ul>}
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"><span className="text-sm text-muted-foreground">{dirty ? "Unsaved changes" : "All changes saved"}</span><div className="grid grid-cols-2 gap-2 sm:flex"><Button variant="outline" disabled={busy || !dirty} onClick={() => setConfirm("reload")}>Discard changes</Button><Button disabled={busy || !dirty || !editable} onClick={() => void save()}>{busy ? "Saving…" : "Save draft"}</Button></div></div>
    <AlertDialog open={confirmationAction !== null} onOpenChange={open => { if (!open && !busy) { setConfirmationAction(null); setMakeDefault(false); } }}><AlertDialogContent className="max-h-[90svh] overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>{confirmationAction === "approve" ? "Approve and lock this version?" : confirmationAction === "retire" ? "Retire this version?" : confirmationAction === "set-default" ? "Make this the default version?" : "Activate this version?"}</AlertDialogTitle><AlertDialogDescription className={confirmationAction === "set-default" ? "sr-only" : undefined}>{confirmationAction === "approve" ? `Approval locks the scoring rules in ${record.version}. To make changes later, duplicate this version. You can activate it after approval.` : confirmationAction === "set-default" ? "Review the version change and affected deployments." : confirmationAction === "retire" ? `New assessments can no longer use ${record.version}. Move any deployments pinned to it to another version first. Assessments already started can still finish. This cannot be undone.` : `You can assign ${record.version} in Deployments after activation.`}</AlertDialogDescription></AlertDialogHeader>{confirmationAction === "activate" && <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={makeDefault} disabled={busy} onChange={event => setMakeDefault(event.target.checked)} /><span><span className="font-medium">Make this the default version</span><span className="mt-1 block text-muted-foreground">Review affected deployments before switching.</span></span></label>}{needsImpact && (defaultImpact ? <DefaultVersionImpact data={defaultImpact} next={record} /> : impactError ? <div role="alert" className="space-y-2 text-sm"><p>Could not load the deployment impact. {impactError}</p><Button variant="outline" onClick={() => setImpactRetry(value => value + 1)}>Retry</Button></div> : <p role="status" className="text-sm text-muted-foreground">Loading deployment impact…</p>)}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy || needsImpact && !defaultImpact} onClick={event => { event.preventDefault(); if (confirmationAction) void transition(confirmationAction); }}>{busy ? "Please wait…" : confirmationAction === "approve" ? "Approve version" : confirmationAction === "set-default" ? "Make default" : confirmationAction === "retire" ? "Retire version" : "Activate version"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={result !== null} onOpenChange={open => { if (!open) setResult(null); }}><DialogContent><DialogHeader><div className="flex items-center gap-3"><div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${result?.success ? "bg-green-50 text-green-700" : "bg-destructive/10 text-destructive"}`}>{result?.success ? <CircleCheck className="size-6" aria-hidden="true" /> : <CircleAlert className="size-6" aria-hidden="true" />}</div><DialogTitle>{result?.success ? result.action === "validate" ? "Checks passed" : result.action === "approve" ? "Version approved" : result.action === "retire" ? "Version retired" : result.action === "set-default" ? "Default updated" : "Version activated" : result?.action === "validate" ? "Checks failed" : result?.action === "approve" ? "Approval failed" : result?.action === "retire" ? "Retirement failed" : result?.action === "set-default" ? "Default update failed" : "Activation failed"}</DialogTitle></div><DialogDescription>{result?.detail}</DialogDescription></DialogHeader>{result && !result.success && <div className="space-y-3">{Boolean(result.reasons?.length) && <ul aria-label="Reasons this action failed" className="max-h-60 list-disc space-y-2 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 py-3 pl-7 pr-3 text-sm">{result.reasons!.map(reason => <li key={reason}>{reason}</li>)}</ul>}<p className="text-sm">{result.reasons?.length ? "Fix these issues and try again." : "Try again after resolving the issue."}</p></div>}<DialogFooter>{result?.success && result.action === "validate" ? <><Button variant="outline" onClick={() => { setResult(null); setTab("scoring"); }}>Edit rules</Button><Button onClick={() => { setResult(null); setConfirmationAction("approve"); }}>Continue to approval</Button></> : <Button onClick={() => setResult(null)}>{result?.success ? "Done" : "Review errors"}</Button>}</DialogFooter></DialogContent></Dialog>
    <AlertDialog open={confirm !== null || blocker.state === "blocked"} onOpenChange={open => { if (!open) { setConfirm(null); if (blocker.state === "blocked") blocker.reset(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Your unsaved edits will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={discardAction}>Discard</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section></DraftContext.Provider>;
}

function FieldRow({ field, expanded, onToggle, definition, disabled, pointDrafts, setPointDrafts, patchField }: { field: FinalField; expanded: boolean; onToggle: () => void; definition: FinalAssessmentDefinition; disabled: boolean; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; patchField: (id: string, change: (field: FinalField) => FinalField) => void }) {
  return <article id={`final-field-${field.id}`} className="min-w-0 rounded-lg border border-border/50 bg-card"><button type="button" className="flex min-h-14 w-full min-w-0 items-center justify-between gap-3 p-3 text-left sm:px-4" aria-label={`${field.label}: ${scoreSummary(field)}`} aria-expanded={expanded} aria-controls={`final-scoring-${field.id}`} onClick={onToggle}><span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="font-semibold">{field.label}{field.unit && <span className="ml-1 font-normal text-muted-foreground">({field.unit})</span>}</span>{expanded ? <Badge variant="secondary" className="rounded-full text-xs font-normal">{typeLabel[field.kind]}</Badge> : <span className="text-sm text-muted-foreground">· {scoreSummary(field)}</span>}</span><ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} /></button>{expanded && <div className="min-w-0 px-3 pb-3 sm:px-4 sm:pb-4"><fieldset id={`final-scoring-${field.id}`} disabled={disabled} className="min-w-0 space-y-4">{(field.kind === "select" || field.kind === "multi_select" || field.kind === "yes_no") && <OptionScoring field={field} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} onChange={next => patchField(field.id, () => next)} />}{field.kind === "conditional" && <ConditionalScoring field={field} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} onChange={next => patchField(field.id, () => next)} />}{field.kind === "count" && <CountScoring field={field} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} onChange={next => patchField(field.id, () => next)} />}{field.kind === "calculated" && <CalculatedScoring field={field} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} onChange={next => patchField(field.id, () => next)} />}{field.kind === "derived" && <DerivedScoring field={field} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} onChange={next => patchField(field.id, () => next)} />}</fieldset></div>}</article>;
}

function OptionScoring({ field, pointDrafts, setPointDrafts, onChange }: { field: OptionField; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; onChange: (field: OptionField) => void }) {
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">{field.kind === "multi_select" ? "Add the points for each selected option." : "Use the points for the selected answer."}</p><div className="overflow-hidden rounded-md border"><div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3 bg-muted/40 px-3 py-2 text-xs font-medium"><span>Option</span><span>Points</span></div><div className="divide-y">{field.options.map(option => { const mapping = field.scoring.points.find(item => item.optionId === option.id); const key = `${field.id}:${option.id}`; return <div key={option.id} className="px-3 py-2"><PointInput label={option.label} value={mapping?.points ?? 0} draft={pointDrafts[key]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [key]: value }))} onCommit={points => onChange({ ...field, scoring: { ...field.scoring, points: field.scoring.points.map(item => item.optionId === option.id ? { ...item, points } : item) } })} /></div>; })}</div></div></div>;
}

function ConditionalScoring({ field, pointDrafts, setPointDrafts, onChange }: { field: Extract<FinalField, { kind: "conditional" }>; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; onChange: (field: Extract<FinalField, { kind: "conditional" }>) => void }) {
  function pointRow(id: string, label: string, points: number, commit: (points: number) => void, indented = false) {
    const key = `${field.id}:${id}`;
    return <div key={id} className={`px-3 py-2 ${indented ? "pl-6" : ""}`}><PointInput label={label} value={points} draft={pointDrafts[key]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [key]: value }))} onCommit={commit} /></div>;
  }
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">Set points for each treatment choice.</p><div className="overflow-hidden rounded-md border"><div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3 bg-muted/40 px-3 py-2 text-xs font-medium"><span>Treatment choice</span><span>Points</span></div><div className="divide-y">{field.options.filter(option => option.id !== field.scoring.palliative.optionId).map(option => pointRow(option.id, option.label, field.scoring.normalPoints.find(item => item.optionId === option.id)!.points, points => onChange({ ...field, scoring: { ...field.scoring, normalPoints: field.scoring.normalPoints.map(item => item.optionId === option.id ? { ...item, points } : item) } })))}<div className="bg-muted/40 px-3 py-2 text-sm font-semibold">Palliative care</div>{field.scoring.palliative.paths.map(path => path.children.length === 0 ? pointRow(path.id, path.label, path.points, points => onChange({ ...field, scoring: { ...field.scoring, palliative: { ...field.scoring.palliative, paths: field.scoring.palliative.paths.map(item => item.id === path.id ? { ...item, points } : item) } } })) : <div key={path.id}><div className="border-b bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">{path.label}</div><div className="divide-y">{path.children.map(child => pointRow(child.id, child.label, child.points, points => onChange({ ...field, scoring: { ...field.scoring, palliative: { ...field.scoring.palliative, paths: field.scoring.palliative.paths.map(item => item.id === path.id ? { ...item, children: item.children.map(itemChild => itemChild.id === child.id ? { ...itemChild, points } : itemChild) } : item) } } }), true))}</div></div>)}</div></div><p className="text-xs text-muted-foreground">For palliative care, use the matching option only.</p></div>;
}

function CountScoring({ field, pointDrafts, setPointDrafts, onChange }: { field: Extract<FinalField, { kind: "count" }>; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; onChange: (field: Extract<FinalField, { kind: "count" }>) => void }) {
  const key = `${field.id}:rate`;
  return <div className="max-w-xs space-y-2"><PointInput label="Points per surgery" value={field.scoring.pointsPerCount} draft={pointDrafts[key]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [key]: value }))} onCommit={pointsPerCount => onChange({ ...field, scoring: { ...field.scoring, pointsPerCount } })} /><p className="text-sm text-muted-foreground">Multiply the number of previous surgeries by these points.</p></div>;
}

function CalculatedScoring({ field, pointDrafts, setPointDrafts, onChange }: { field: Extract<FinalField, { kind: "calculated" }>; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; onChange: (field: Extract<FinalField, { kind: "calculated" }>) => void }) {
  const names = ["No change or weight gain", "Mild weight loss", "Moderate weight loss", "Severe weight loss"];
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">Based on current weight and weight from 1–2 months ago.</p><div className="overflow-hidden rounded-md border"><div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3 bg-muted/40 px-3 py-2 text-xs font-medium"><span>Weight change</span><span>Points</span></div><div className="divide-y">{field.scoring.bands.map((band, index) => <div key={band.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 px-3 py-2"><div className="min-w-0 text-sm"><span>{names[index] ?? `Range ${index + 1}`}</span>{index > 0 && <span className="block text-xs text-muted-foreground">{rangeText(band)}</span>}</div><PointInput hideLabel label="Points" value={band.points} draft={pointDrafts[`${field.id}:${band.id}`]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [`${field.id}:${band.id}`]: value }))} onCommit={points => onChange({ ...field, scoring: { ...field.scoring, bands: field.scoring.bands.map(item => item.id === band.id ? { ...item, points } : item) } })} /></div>)}</div></div><details className="text-sm"><summary className="cursor-pointer text-primary">Edit percentage ranges</summary><p className="mt-3 text-xs text-muted-foreground">Weight loss (%) = (previous weight − current weight) ÷ previous weight × 100.</p><div className="mt-3 space-y-3">{field.scoring.bands.map((band, index) => <div key={band.id} className="space-y-2 rounded-md border p-3"><p className="font-medium">{names[index]}</p><div className="grid gap-3 sm:grid-cols-2"><BoundaryInput id={`${band.id}-from`} label="From (%)" value={band.min} inclusive={band.minInclusive} disabled={false} onChange={(min, minInclusive) => onChange({ ...field, scoring: { ...field.scoring, bands: field.scoring.bands.map(item => item.id === band.id ? { ...item, min, minInclusive } : item) } })} /><BoundaryInput id={`${band.id}-to`} label="To (%)" value={band.max} inclusive={band.maxInclusive} disabled={false} onChange={(max, maxInclusive) => onChange({ ...field, scoring: { ...field.scoring, bands: field.scoring.bands.map(item => item.id === band.id ? { ...item, max, maxInclusive } : item) } })} /></div></div>)}</div></details></div>;
}

function DerivedScoring({ field, pointDrafts, setPointDrafts, onChange }: { field: Extract<FinalField, { kind: "derived" }>; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; onChange: (field: Extract<FinalField, { kind: "derived" }>) => void }) {
  return <div className="grid gap-3 sm:grid-cols-2">{field.scoring.outcomes.map(outcome => <div key={outcome.id} className="flex min-w-0 flex-col gap-3 rounded-md border p-3"><div className="flex-1"><h4 className="text-sm font-semibold">{outcome.label}</h4><p className="mt-1 text-sm text-muted-foreground">{outcome.label === "Adequate" ? "Normal intake · More than usual" : "Reduced intake · Liquid diet · Little solid food · Tube feeding"}</p></div><PointInput label={`${outcome.label} points`} value={outcome.points} draft={pointDrafts[`${field.id}:${outcome.id}`]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [`${field.id}:${outcome.id}`]: value }))} onCommit={points => onChange({ ...field, scoring: { ...field.scoring, outcomes: field.scoring.outcomes.map(item => item.id === outcome.id ? { ...item, points } : item) } })} /></div>)}</div>;
}

function RiskEditor({ definition, disabled, onChange }: { definition: FinalAssessmentDefinition; disabled: boolean; onChange: (definition: FinalAssessmentDefinition) => void }) {
  const patch = (id: string, change: Partial<FinalAssessmentDefinition["riskCategories"][number]>) => onChange({ ...definition, riskCategories: definition.riskCategories.map(category => category.id === id ? { ...category, ...change } : category) });
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-2xl border border-border/50 bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-medium">Risk categories</h2><p className="mt-1 text-sm text-muted-foreground">The total assessment score determines the risk category.</p></div><Button type="button" variant="outline" onClick={() => onChange({ ...definition, riskCategories: [...definition.riskCategories, { id: newRuleId("category"), label: "New category", color: "neutral", interpretation: "", min: null, max: null, minInclusive: true, maxInclusive: true, sources: [] }] })}>Add category</Button></div>{definition.riskCategories.map(category => <section key={category.id} className="space-y-3 rounded-xl border p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm"><span className="font-medium">Category name</span><Input value={category.label} onChange={event => patch(category.id, { label: event.target.value })} /></label><label className="space-y-1 text-sm"><span className="font-medium">What it means</span><Input value={category.interpretation} onChange={event => patch(category.id, { interpretation: event.target.value })} /></label><BoundaryInput id={`${category.id}-from`} label="From score" value={category.min} inclusive={category.minInclusive} disabled={disabled} onChange={(min, minInclusive) => patch(category.id, { min, minInclusive })} /><BoundaryInput id={`${category.id}-to`} label="To score" value={category.max} inclusive={category.maxInclusive} disabled={disabled} onChange={(max, maxInclusive) => patch(category.id, { max, maxInclusive })} /></div><Button type="button" variant="ghost" className="text-destructive" disabled={definition.riskCategories.length <= 1} onClick={() => onChange({ ...definition, riskCategories: definition.riskCategories.filter(item => item.id !== category.id) })}>Remove category</Button></section>)}<p className="text-sm text-muted-foreground">Ranges must cover every possible non-negative score exactly once. Duplicate labels and gaps are rejected.</p></fieldset>;
}
