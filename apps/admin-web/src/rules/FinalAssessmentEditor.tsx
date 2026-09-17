import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useEffect, useMemo, useState } from "react";
import { useBlocker } from "react-router-dom";
import { finalAssessmentDefinitionSchema, type FinalAssessmentDefinition, type FinalAssessmentField } from "@niq-scoring/contracts/final-assessment";
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
import { newRuleId } from "./questionnaire-model";
import type { RuleDetail } from "./rule-api";

type Tab = "details" | "scoring" | "risk categories" | "interventions";
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

function scoreSummary(field: FinalField) {
  if (field.kind === "calculated") return `${field.scoring.bands.length} weight-loss bands`;
  if (field.kind === "derived") return `${field.scoring.outcomes.length} mapped outcomes`;
  if (field.kind === "count") return `${field.scoring.pointsPerCount} point per surgery`;
  if (field.kind === "conditional") return "Ordinary and palliative paths";
  return `${field.options.length} fixed options`;
}

function rangeText(range: { min: number | null; max: number | null; minInclusive: boolean; maxInclusive: boolean }) {
  const lower = range.min === null ? "No lower limit" : `${range.minInclusive ? "≥" : ">"} ${range.min}`;
  const upper = range.max === null ? "No upper limit" : `${range.maxInclusive ? "≤" : "<"} ${range.max}`;
  return `${lower} and ${upper}`;
}

function PointInput({ label, value, draft, disabled, onDraft, onCommit }: { label: string; value: number; draft: string | undefined; disabled: boolean; onDraft: (value: string) => void; onCommit: (value: number) => void }) {
  return <label className="space-y-1 text-sm"><span className="font-medium">{label}</span><Input type="number" min={0} step="any" disabled={disabled} aria-label={`${label} points`} value={draft ?? String(value)} onChange={event => { const next = event.target.value; onDraft(next); if (next !== "") { const number = Number(next); if (Number.isFinite(number) && number >= 0) onCommit(number); } }} /></label>;
}

function BoundaryInput({ label, value, inclusive, disabled, onChange }: { label: string; value: number | null; inclusive: boolean; disabled: boolean; onChange: (value: number | null, inclusive: boolean) => void }) {
  const mode = value === null ? "none" : inclusive ? "inclusive" : "exclusive";
  return <div className="space-y-1 text-sm"><span className="font-medium">{label}</span><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]"><NativeSelect disabled={disabled} value={mode} onChange={event => { const next = event.target.value; onChange(next === "none" ? null : value ?? 0, next !== "exclusive"); }}><option value="none">No limit</option><option value="inclusive">Inclusive</option><option value="exclusive">Exclusive</option></NativeSelect>{value !== null && <Input type="number" step="any" disabled={disabled} aria-label={label} value={value} onChange={event => onChange(event.target.value === "" ? null : Number(event.target.value), inclusive)} />}</div></div>;
}

export function FinalAssessmentEditor({ initial, onClose, onSaved }: { initial: RuleDetail; onClose: () => void; onSaved: () => void }) {
  const [record, setRecord] = useState(initial);
  const [definition, setDefinition] = useState(() => parse(initial.definition));
  const saved = useMemo(() => parse(record.definition), [record.definition]);
  const [tab, setTab] = useState<Tab>("scoring");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pointDrafts, setPointDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [confirm, setConfirm] = useState<"close" | "reload" | null>(null);
  const dirty = definition !== null && JSON.stringify(definition) !== JSON.stringify(saved);
  const blocker = useBlocker(dirty || busy);
  const editable = definition !== null && isFixedFinalAssessmentDefinition(record.definition) && ["DRAFT", "VALIDATED"].includes(record.lifecycle);

  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy]);

  function update(next: FinalAssessmentDefinition) { setDefinition(next); setNotice(""); setIssues([]); }
  function patchField(id: string, change: (field: FinalField) => FinalField) {
    if (!definition) return;
    update({ ...definition, sections: definition.sections.map(section => ({ ...section, fields: section.fields.map(field => field.id === id ? change(field) : field) })) });
  }
  function accept(next: RuleDetail) { const parsed = parse(next.definition); setRecord(next); setDefinition(parsed); setPointDrafts({}); onSaved(); }
  async function reload() {
    setBusy(true); setError("");
    try { accept(await request<RuleDetail>(`/admin/rules/${record.id}`)); setIssues([]); setNotice(""); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function save() {
    if (!definition) return;
    setError(""); setNotice(""); setIssues([]);
    const draftIssue = Object.entries(pointDrafts).find(([, value]) => value === "" || !Number.isFinite(Number(value)) || Number(value) < 0);
    if (draftIssue) { setIssues([{ message: "Every point value must be a finite number greater than or equal to zero." }]); return; }
    const parsed = finalAssessmentDefinitionSchema.safeParse(definition);
    if (!parsed.success) { setIssues(parsed.error.issues); return; }
    const checks = validateFinalAssessmentDefinition(parsed.data);
    const invalid = checks.filter(issue => issue.severity === "error");
    if (invalid.length) { setIssues(invalid); return; }
    setBusy(true);
    try { accept(await request<RuleDetail>(`/admin/rules/${record.id}`, { revision: record.revision, definition: parsed.data }, "PUT")); setNotice("Draft saved. Temporary risk thresholds remain blocked from clinical use."); }
    catch (cause) { setError(message(cause)); if (cause instanceof ApiError) setIssues(cause.issues.filter(issue => issue !== null && typeof issue === "object") as Issue[]); }
    finally { setBusy(false); }
  }

  if (!definition) return <section className="space-y-5 pt-6"><ErrorNotice error="This final assessment definition could not be read." /></section>;
  const section = definition.sections[sectionIndex] ?? definition.sections[0]!;
  const close = () => { if (busy) return; if (dirty) setConfirm("close"); else onClose(); };
  const discardAction = (event: React.MouseEvent) => { const action = confirm; setConfirm(null); if (blocker.state === "blocked") { event.preventDefault(); blocker.proceed(); } else if (action === "reload") void reload(); else onClose(); };
  return <section className="min-w-0 space-y-6 pt-6" aria-label="Final assessment version editor">
    <header className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm"><Button variant="link" className="h-auto shrink-0 p-0 font-normal" aria-label="Back to versions" disabled={busy} onClick={close}>Rule versions</Button><span aria-hidden="true" className="text-muted-foreground">/</span><span aria-current="page" className="truncate text-muted-foreground">{record.version}</span></nav>
      <div className="flex flex-wrap items-center gap-3"><h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{record.version}</h1><Badge variant="secondary" className="gap-1.5 rounded-full px-2.5 py-1"><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{record.lifecycle.charAt(0) + record.lifecycle.slice(1).toLowerCase()}</Badge>{dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}{!editable && <span className="text-sm text-muted-foreground">Read-only</span>}</div>
    </header>
    {!editable && <p className="text-sm text-muted-foreground">This version is read-only. Duplicate it to make changes.</p>}
    <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-medium">Temporary risk thresholds — awaiting confirmation</p><p className="mt-1">This final assessment is an internal draft only. Approval, activation and public evaluation stay blocked until the client confirms clinical thresholds.</p></div>
    <Tabs value={tab} onValueChange={value => setTab(value as Tab)} className="gap-5">
      <TabsList variant="line" aria-label="Rule version sections" className="h-auto min-h-11 w-full flex-wrap justify-start gap-x-6 gap-y-1 rounded-none border-b p-0">
        {(["details", "scoring", "risk categories", "interventions"] as Tab[]).map(item => <TabsTrigger key={item} value={item} className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">{item.charAt(0).toUpperCase() + item.slice(1)}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="details"><div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl bg-card p-5 shadow-sm sm:p-6"><h2 className="mb-5 border-b pb-4 text-lg font-medium">Version details</h2><fieldset disabled={!editable || busy} className="space-y-3"><label className="block space-y-2 text-sm"><Label htmlFor="final-rule-name">Name</Label><Input id="final-rule-name" value={definition.name} maxLength={80} onChange={event => update({ ...definition, name: event.target.value })} /></label><label className="block space-y-2 text-sm"><Label htmlFor="final-rule-description">Description</Label><Textarea id="final-rule-description" value={definition.description} onChange={event => update({ ...definition, description: event.target.value })} /></label></fieldset></section><section className="rounded-2xl bg-card p-5 shadow-sm sm:p-6"><h2 className="mb-5 border-b pb-4 text-lg font-medium">Profile status</h2><dl className="space-y-3"><div className="rounded-xl bg-muted/40 p-4"><dt className="text-sm text-muted-foreground">Profile</dt><dd className="mt-1 font-medium">NIQ final assessment v2</dd></div><div className="rounded-xl bg-muted/40 p-4"><dt className="text-sm text-muted-foreground">Clinical use</dt><dd className="mt-1 font-medium">Blocked — provisional</dd></div></dl></section></div></TabsContent>
      <TabsContent value="scoring" forceMount className="data-[state=inactive]:hidden"><div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"><aside className="min-w-0"><div className="lg:hidden"><Label htmlFor="final-section-select">Assessment section</Label><NativeSelect id="final-section-select" className="mt-2" value={section.id} onChange={event => setSectionIndex(Math.max(0, definition.sections.findIndex(item => item.id === event.target.value)))}>{definition.sections.map(item => <option key={item.id} value={item.id}>{item.title} ({item.fields.length})</option>)}</NativeSelect></div><nav aria-label="Scoring sections" className="hidden space-y-2 lg:block">{definition.sections.map((item, index) => <button key={item.id} type="button" className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm ${index === sectionIndex ? "bg-muted font-medium" : "hover:bg-muted/60"}`} aria-current={index === sectionIndex ? "page" : undefined} onClick={() => setSectionIndex(index)}><span>{item.title}</span><span className="text-xs text-muted-foreground">{item.fields.length}</span></button>)}</nav></aside><section className="min-w-0 space-y-4"><div><h2 className="text-xl font-semibold">{section.title}</h2><p className="mt-1 text-sm text-muted-foreground">{section.description} Fixed fields and additive scoring; no caps are used.</p></div><div className="overflow-x-auto rounded-2xl border border-border/50 bg-card shadow-sm"><table className="w-full min-w-[40rem] text-left text-sm"><thead className="border-b bg-muted/30"><tr><th className="p-3 font-medium">Field name</th><th className="p-3 font-medium">Type</th><th className="p-3 font-medium">Scoring</th></tr></thead><tbody>{section.fields.map(field => <FieldRow key={field.id} field={field} expanded={expanded === field.id} onToggle={() => setExpanded(expanded === field.id ? null : field.id)} definition={definition} disabled={!editable || busy} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} patchField={patchField} />)}</tbody></table></div></section></div></TabsContent>
      <TabsContent value="risk categories"><RiskEditor definition={definition} disabled={!editable || busy} onChange={update} /></TabsContent>
      <TabsContent value="interventions"><section className="rounded-2xl bg-card p-6 shadow-sm"><h2 className="font-medium">Interventions</h2><p className="mt-2 text-sm text-muted-foreground">N/A — interventions are intentionally deferred for this final assessment profile.</p></section></TabsContent>
    </Tabs>
    <ErrorNotice error={error} />{notice && <p role="status" className="text-sm">{notice}</p>}{issues.length > 0 && <ul aria-label="Configuration issues" className="space-y-2 rounded-lg border border-destructive/30 p-4">{issues.map((issue, index) => <li key={index} className="text-sm">{issue.message ?? "Review this configuration."}</li>)}</ul>}
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-background py-4"><span className="text-sm text-muted-foreground">{dirty ? "Unsaved changes" : "All changes saved"}</span><div className="flex gap-2"><Button variant="outline" disabled={busy || !dirty} onClick={() => setConfirm("reload")}>Discard changes</Button><Button disabled={busy || !dirty || !editable} onClick={() => void save()}>{busy ? "Saving…" : "Save draft"}</Button></div></div>
    <AlertDialog open={confirm !== null || blocker.state === "blocked"} onOpenChange={open => { if (!open) { setConfirm(null); if (blocker.state === "blocked") blocker.reset(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Your unsaved edits will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={discardAction}>Discard</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

function FieldRow({ field, expanded, onToggle, definition, disabled, pointDrafts, setPointDrafts, patchField }: { field: FinalField; expanded: boolean; onToggle: () => void; definition: FinalAssessmentDefinition; disabled: boolean; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; patchField: (id: string, change: (field: FinalField) => FinalField) => void }) {
  return <><tr id={`final-field-${field.id}`} className="border-b"><td className="p-3 font-medium">{field.label}{field.unit && <span className="ml-1 font-normal text-muted-foreground">({field.unit})</span>}</td><td className="p-3 text-muted-foreground">{typeLabel[field.kind]}</td><td className="p-3"><button type="button" className="text-primary underline-offset-4 hover:underline" aria-expanded={expanded} aria-controls={`final-scoring-${field.id}`} onClick={onToggle}>{scoreSummary(field)}</button></td></tr>{expanded && <tr><td colSpan={3} className="border-b bg-muted/10 p-4"><fieldset id={`final-scoring-${field.id}`} disabled={disabled} className="space-y-4"><p className="text-sm text-muted-foreground">Source: {field.sources.map(source => `${source.document} · ${source.location}`).join("; ")}</p>{(field.kind === "select" || field.kind === "multi_select" || field.kind === "yes_no") && <OptionScoring field={field} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} onChange={next => patchField(field.id, () => next)} />}{field.kind === "conditional" && <ConditionalScoring field={field} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} onChange={next => patchField(field.id, () => next)} />}{field.kind === "count" && <CountScoring field={field} onChange={next => patchField(field.id, () => next)} />}{field.kind === "calculated" && <CalculatedScoring field={field} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} onChange={next => patchField(field.id, () => next)} />}{field.kind === "derived" && <DerivedScoring field={field} pointDrafts={pointDrafts} setPointDrafts={setPointDrafts} onChange={next => patchField(field.id, () => next)} />}</fieldset></td></tr>}</>;
}

function OptionScoring({ field, pointDrafts, setPointDrafts, onChange }: { field: OptionField; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; onChange: (field: OptionField) => void }) {
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">Selected options add together. A blank answer remains distinct from an explicit zero-point answer.</p><div className="grid gap-3 sm:grid-cols-2">{field.options.map(option => { const mapping = field.scoring.points.find(item => item.optionId === option.id); const key = `${field.id}:${option.id}`; return <PointInput key={option.id} label={option.label} value={mapping?.points ?? 0} draft={pointDrafts[key]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [key]: value }))} onCommit={points => onChange({ ...field, scoring: { ...field.scoring, points: field.scoring.points.map(item => item.optionId === option.id ? { ...item, points } : item) } })} />; })}</div></div>;
}

function ConditionalScoring({ field, pointDrafts, setPointDrafts, onChange }: { field: Extract<FinalField, { kind: "conditional" }>; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; onChange: (field: Extract<FinalField, { kind: "conditional" }>) => void }) {
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">Palliative treatment uses the selected path and, when applicable, its post-treatment timing.</p><div className="grid gap-3 sm:grid-cols-2">{field.options.filter(option => option.id !== field.scoring.palliative.optionId).map(option => { const mapping = field.scoring.normalPoints.find(item => item.optionId === option.id)!; const key = `${field.id}:${option.id}`; return <PointInput key={option.id} label={option.label} value={mapping?.points ?? 0} draft={pointDrafts[key]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [key]: value }))} onCommit={points => onChange({ ...field, scoring: { ...field.scoring, normalPoints: field.scoring.normalPoints.map(item => item.optionId === option.id ? { ...item, points } : item) } })} />; })}</div>{field.scoring.palliative.paths.map(path => <div key={path.id} className="space-y-3 rounded-xl border p-3"><div className="flex items-center justify-between"><h4 className="font-medium">{path.label}</h4><span className="text-xs text-muted-foreground">Palliative path</span></div>{path.children.length === 0 ? <PointInput label="Path points" value={path.points} draft={pointDrafts[`${field.id}:${path.id}`]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [`${field.id}:${path.id}`]: value }))} onCommit={points => onChange({ ...field, scoring: { ...field.scoring, palliative: { ...field.scoring.palliative, paths: field.scoring.palliative.paths.map(item => item.id === path.id ? { ...item, points } : item) } } })} /> : <div className="grid gap-3 sm:grid-cols-3">{path.children.map(child => <PointInput key={child.id} label={child.label} value={child.points} draft={pointDrafts[`${field.id}:${child.id}`]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [`${field.id}:${child.id}`]: value }))} onCommit={points => onChange({ ...field, scoring: { ...field.scoring, palliative: { ...field.scoring.palliative, paths: field.scoring.palliative.paths.map(item => item.id === path.id ? { ...item, children: item.children.map(childItem => childItem.id === child.id ? { ...childItem, points } : childItem) } : item) } } })} />)}</div>}</div>)}</div>;
}

function CountScoring({ field, onChange }: { field: Extract<FinalField, { kind: "count" }>; onChange: (field: Extract<FinalField, { kind: "count" }>) => void }) {
  return <div className="max-w-xs space-y-2"><Label htmlFor={`${field.id}-rate`}>Points per previous surgery</Label><Input id={`${field.id}-rate`} type="number" min={0} step="any" value={field.scoring.pointsPerCount} onChange={event => onChange({ ...field, scoring: { ...field.scoring, pointsPerCount: event.target.value === "" ? 0 : Number(event.target.value) } })} /><p className="text-sm text-muted-foreground">The submitted surgery count is multiplied by this fixed rate.</p></div>;
}

function CalculatedScoring({ field, pointDrafts, setPointDrafts, onChange }: { field: Extract<FinalField, { kind: "calculated" }>; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; onChange: (field: Extract<FinalField, { kind: "calculated" }>) => void }) {
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">{field.formula}. The unrounded percentage determines the band.</p>{field.scoring.bands.map((band, index) => <div key={band.id} className="space-y-3 rounded-xl border p-3"><div className="flex items-center justify-between"><h4 className="font-medium">Band {index + 1}</h4><span className="text-xs text-muted-foreground">{rangeText(band)}</span></div><div className="grid gap-3 sm:grid-cols-2"><BoundaryInput label="Lower bound" value={band.min} inclusive={band.minInclusive} disabled={false} onChange={(min, minInclusive) => onChange({ ...field, scoring: { ...field.scoring, bands: field.scoring.bands.map(item => item.id === band.id ? { ...item, min, minInclusive } : item) } })} /><BoundaryInput label="Upper bound" value={band.max} inclusive={band.maxInclusive} disabled={false} onChange={(max, maxInclusive) => onChange({ ...field, scoring: { ...field.scoring, bands: field.scoring.bands.map(item => item.id === band.id ? { ...item, max, maxInclusive } : item) } })} /></div><PointInput label="Band points" value={band.points} draft={pointDrafts[`${field.id}:${band.id}`]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [`${field.id}:${band.id}`]: value }))} onCommit={points => onChange({ ...field, scoring: { ...field.scoring, bands: field.scoring.bands.map(item => item.id === band.id ? { ...item, points } : item) } })} /></div>)}</div>;
}

function DerivedScoring({ field, pointDrafts, setPointDrafts, onChange }: { field: Extract<FinalField, { kind: "derived" }>; pointDrafts: Record<string, string>; setPointDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; onChange: (field: Extract<FinalField, { kind: "derived" }>) => void }) {
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">Protein adequacy is derived from the dietary intake supporting input. The mapping is fixed to the audited profile.</p><div className="grid gap-3 sm:grid-cols-2">{field.scoring.outcomes.map(outcome => <PointInput key={outcome.id} label={outcome.label} value={outcome.points} draft={pointDrafts[`${field.id}:${outcome.id}`]} disabled={false} onDraft={value => setPointDrafts(current => ({ ...current, [`${field.id}:${outcome.id}`]: value }))} onCommit={points => onChange({ ...field, scoring: { ...field.scoring, outcomes: field.scoring.outcomes.map(item => item.id === outcome.id ? { ...item, points } : item) } })} />)}</div><dl className="grid gap-2 text-sm sm:grid-cols-2">{field.scoring.mapping.map(item => <div key={item.inputOptionId} className="rounded-lg bg-muted/40 p-3"><dt className="text-muted-foreground">{item.inputOptionId}</dt><dd className="font-medium">{field.scoring.outcomes.find(outcome => outcome.id === item.outcomeId)?.label ?? item.outcomeId}</dd></div>)}</dl></div>;
}

function RiskEditor({ definition, disabled, onChange }: { definition: FinalAssessmentDefinition; disabled: boolean; onChange: (definition: FinalAssessmentDefinition) => void }) {
  const patch = (id: string, change: Partial<FinalAssessmentDefinition["riskCategories"][number]>) => onChange({ ...definition, riskCategories: definition.riskCategories.map(category => category.id === id ? { ...category, ...change } : category) });
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-2xl border border-border/50 bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-medium">Temporary risk categories</h2><p className="mt-1 text-sm text-muted-foreground">These ranges are visible for internal review only and are not clinical guidance.</p></div><Button type="button" variant="outline" onClick={() => onChange({ ...definition, riskCategories: [...definition.riskCategories, { id: newRuleId("category"), label: "New category", interpretation: "Awaiting client confirmation.", min: null, max: null, minInclusive: true, maxInclusive: true, sources: [] }] })}>Add category</Button></div>{definition.riskCategories.map(category => <section key={category.id} className="space-y-3 rounded-xl border p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm"><span className="font-medium">Category name</span><Input value={category.label} onChange={event => patch(category.id, { label: event.target.value })} /></label><label className="space-y-1 text-sm"><span className="font-medium">What it means</span><Input value={category.interpretation} onChange={event => patch(category.id, { interpretation: event.target.value })} /></label><BoundaryInput label="Lower bound" value={category.min} inclusive={category.minInclusive} disabled={disabled} onChange={(min, minInclusive) => patch(category.id, { min, minInclusive })} /><BoundaryInput label="Upper bound" value={category.max} inclusive={category.maxInclusive} disabled={disabled} onChange={(max, maxInclusive) => patch(category.id, { max, maxInclusive })} /></div><Button type="button" variant="ghost" className="text-destructive" disabled={definition.riskCategories.length <= 1} onClick={() => onChange({ ...definition, riskCategories: definition.riskCategories.filter(item => item.id !== category.id) })}>Remove category</Button></section>)}<p className="text-sm text-muted-foreground">Ranges must cover every possible non-negative score exactly once. Duplicate labels and gaps are rejected.</p></fieldset>;
}
