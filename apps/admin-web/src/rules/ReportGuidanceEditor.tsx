import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { classOnlyToxicity } from "@niq-scoring/contracts/report-guidance";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { NativeSelect } from "../components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { ToxicityMatchEditor, toxicityMatchLabel } from "./ToxicityMatchEditor";
import { toxicityMatchSuggestion } from "./toxicityMatchSuggestions";

type Guidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;
type Nutrition = Guidance["nutrition"][number];
type Toxicity = Guidance["toxicity"][number];
type EditorState = { kind: "nutrition"; item: Nutrition; isNew: boolean } | { kind: "toxicity"; item: Toxicity; isNew: boolean };
type Props = { definition: FinalAssessmentDefinition; disabled: boolean; onChange: (definition: FinalAssessmentDefinition) => void };

const emptyGuidance: Guidance = { nutrition: [], toxicity: [] };
const newId = (kind: "nutrition" | "toxicity") => `${kind}_${crypto.randomUUID().replaceAll("-", "")}`;
const searchMatch = (query: string, ...values: string[]) => values.some(value => value.toLocaleLowerCase().includes(query));

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}

export function ReportGuidanceEditor({ definition, disabled, onChange }: Props) {
  const guidance = definition.reportGuidance ?? emptyGuidance;
  const [section, setSection] = useState<"nutrition" | "toxicity">("nutrition");
  const [nutritionSearch, setNutritionSearch] = useState("");
  const [toxicitySearch, setToxicitySearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [original, setOriginal] = useState<EditorState | null>(null);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleting, setDeleting] = useState<{ kind: "nutrition" | "toxicity"; id: string } | null>(null);
  const riskCategories = definition.riskCategories;
  const drugClasses = definition.drugClassConfig?.classes.filter(item => item.id !== "other") ?? [];
  const treatments = definition.sections.flatMap(item => item.fields).filter(item => item.id === "current_cancer_treatment" && "options" in item).flatMap(item => "options" in item ? item.options : []);
  const riskName = (id: string | null) => id === null ? "Any risk category" : riskCategories.find(item => item.id === id)?.label ?? id;
  const className = (id: string) => drugClasses.find(item => item.id === id)?.label ?? id;
  const treatmentName = (id: string) => treatments.find(item => item.id === id)?.label ?? id;
  const suggestedMatchLabel = (item: Toxicity) => {
    const suggestion = toxicityMatchSuggestion(definition, item);
    return suggestion ? toxicityMatchLabel(definition, suggestion) : "No suggestion for this edited row";
  };

  const filteredNutrition = useMemo(() => guidance.nutrition.filter(item => {
    const query = nutritionSearch.trim().toLocaleLowerCase();
    return (riskFilter === "all" || (riskFilter === "any" ? item.riskCategoryId === null : item.riskCategoryId === riskFilter))
      && (statusFilter === "all" || item.enabled === (statusFilter === "enabled"))
      && (!query || searchMatch(query, item.label, riskName(item.riskCategoryId), item.coreStrategy, item.clinicalActions));
  }), [guidance.nutrition, nutritionSearch, riskFilter, statusFilter, riskCategories]);
  const filteredToxicity = useMemo(() => guidance.toxicity.filter(item => {
    const query = toxicitySearch.trim().toLocaleLowerCase();
    return (classFilter === "all" || item.classId === classFilter)
      && (matchFilter === "all" || (item.match?.mode ?? "needs_review") === matchFilter)
      && (statusFilter === "all" || item.enabled === (statusFilter === "enabled"))
      && (!query || searchMatch(query, className(item.classId), treatmentName(item.treatmentTypeId), classOnlyToxicity(item).expectedToxicity, classOnlyToxicity(item).nutritionalInterventions, toxicityMatchLabel(definition, item.match)));
  }), [guidance.toxicity, toxicitySearch, classFilter, matchFilter, statusFilter, drugClasses, treatments, definition]);
  const matchCounts = {
    needsReview: guidance.toxicity.filter(item => !item.match).length,
    assessment: guidance.toxicity.filter(item => item.match?.mode === "assessment_answer" || item.match?.mode === "weight_change").length,
    clinician: guidance.toxicity.filter(item => item.match?.mode === "clinician_confirmation").length,
  };
  const suggestedCount = guidance.toxicity.filter(item => !item.match && toxicityMatchSuggestion(definition, item)).length;
  const updatedSuggestions = guidance.toxicity.filter(item => item.match?.mode === "clinician_confirmation" &&
    toxicityMatchSuggestion(definition, item)?.mode !== "clinician_confirmation" && toxicityMatchSuggestion(definition, item));

  const change = (next: Guidance) => onChange({ ...definition, reportGuidance: next });
  const startEdit = (kind: "nutrition" | "toxicity", item?: Nutrition | Toxicity) => {
    setError("");
    const next: EditorState = kind === "nutrition"
      ? { kind, item: item as Nutrition ?? { id: newId(kind), label: "", riskCategoryId: null, coreStrategy: "", clinicalActions: "", enabled: true, source: { document: "Manual entry", location: "Rules editor", note: "" } }, isNew: !item }
      : { kind, item: item ? classOnlyToxicity(item as Toxicity) : { id: newId(kind), classId: "", treatmentTypeId: "", expectedToxicity: "", nutritionalInterventions: "", enabled: true, requiresDrugConfirmation: false, source: { document: "Manual entry", location: "Rules editor", note: "" } }, isNew: !item };
    setEditing(next);
    setOriginal(structuredClone(next));
  };
  const closeEdit = () => { setConfirmClose(false); setEditing(null); setOriginal(null); setError(""); };
  const requestClose = () => {
    if (editing && original && JSON.stringify(editing) !== JSON.stringify(original)) setConfirmClose(true);
    else closeEdit();
  };
  const saveEdit = () => {
    if (!editing) return;
    const source = {
      document: editing.item.source.document.trim() || "Manual entry",
      location: editing.item.source.location.trim() || "Rules editor",
      note: editing.item.source.note.trim(),
    };
    if (editing.kind === "nutrition") {
      const item = editing.item;
      if (!item.label.trim() || !item.coreStrategy.trim() || !item.clinicalActions.trim()) { setError("Enter a name, core strategy, and clinical actions."); return; }
      if (item.riskCategoryId !== null && !riskCategories.some(category => category.id === item.riskCategoryId)) { setError("Select a configured risk category."); return; }
      if (item.enabled && guidance.nutrition.some(row => row.id !== item.id && row.enabled && item.riskCategoryId !== null && row.riskCategoryId === item.riskCategoryId)) { setError("An active intervention already covers this risk category."); return; }
      const clean = { ...item, label: item.label.trim(), coreStrategy: item.coreStrategy.trim(), clinicalActions: item.clinicalActions.trim(), source };
      change({ ...guidance, nutrition: editing.isNew ? [...guidance.nutrition, clean] : guidance.nutrition.map(row => row.id === clean.id ? clean : row) });
    } else {
      const item = classOnlyToxicity(editing.item);
      if (!drugClasses.some(drugClass => drugClass.id === item.classId) || !treatments.some(treatment => treatment.id === item.treatmentTypeId)) { setError("Select a configured drug class and treatment."); return; }
      if (!item.expectedToxicity.trim() || !item.nutritionalInterventions.trim()) { setError("Enter an expected toxicity and nutritional intervention."); return; }
      if (!item.match) { setError("Choose how this effect is confirmed before saving the row."); return; }
      if (item.match.mode === "assessment_answer" && item.match.anyOf.some(pair => !pair.fieldId || !pair.optionId)) { setError("Choose a field and answer for every assessment match."); return; }
      if (item.match.mode === "assessment_answer" && item.match.operator === "all" && item.match.anyOf.some((pair, index) => {
        const field = definition.sections.flatMap(section => section.fields).find(value => value.id === pair.fieldId);
        return field?.kind === "select" && item.match?.mode === "assessment_answer" && item.match.anyOf.some((other, at) => at < index && other.fieldId === pair.fieldId && other.optionId !== pair.optionId);
      })) { setError("A single-choice field cannot have two different answers at once. Choose Any, or use different fields for All."); return; }
      if (item.enabled && guidance.toxicity.some(row => row.id !== item.id && row.enabled && row.classId === item.classId && row.treatmentTypeId === item.treatmentTypeId && classOnlyToxicity(row).expectedToxicity.trim().toLocaleLowerCase() === item.expectedToxicity.trim().toLocaleLowerCase())) { setError("An active intervention already covers this class, treatment, and toxicity."); return; }
      const clean = { ...item, expectedToxicity: item.expectedToxicity.trim(), nutritionalInterventions: item.nutritionalInterventions.trim(), source };
      change({ ...guidance, toxicity: editing.isNew ? [...guidance.toxicity, clean] : guidance.toxicity.map(row => row.id === clean.id ? clean : row) });
    }
    closeEdit();
  };
  const remove = () => {
    if (!deleting) return;
    change(deleting.kind === "nutrition"
      ? { ...guidance, nutrition: guidance.nutrition.filter(item => item.id !== deleting.id) }
      : { ...guidance, toxicity: guidance.toxicity.filter(item => item.id !== deleting.id) });
    setDeleting(null);
  };
  const fillSuggestedMatches = () => change({
    ...guidance,
    toxicity: guidance.toxicity.map(item => item.match
      ? item
      : { ...item, match: toxicityMatchSuggestion(definition, item) }),
  });
  const applyUpdatedSuggestions = () => change({
    ...guidance,
    toxicity: guidance.toxicity.map(item => updatedSuggestions.some(candidate => candidate.id === item.id)
      ? { ...item, match: toxicityMatchSuggestion(definition, item) }
      : item),
  });
  const reviewSuggestion = editing?.kind === "toxicity" ? toxicityMatchSuggestion(definition, editing.item) : undefined;
  return <section className="min-w-0 space-y-5 rounded-2xl bg-card p-4 shadow-sm sm:p-6" aria-label="Report guidance">
    <h2 className="text-lg font-medium">Nutrition &amp; toxicity rules</h2>
    <div className="flex flex-wrap gap-2 border-b pb-3" aria-label="Guidance type">
      <Button type="button" variant={section === "nutrition" ? "default" : "outline"} onClick={() => setSection("nutrition")}>Nutrition by risk <span className="ml-1 opacity-75">{guidance.nutrition.length}</span></Button>
      <Button type="button" variant={section === "toxicity" ? "default" : "outline"} onClick={() => setSection("toxicity")}>Drug-class toxicity <span className="ml-1 opacity-75">{guidance.toxicity.length}</span></Button>
    </div>
    {section === "nutrition" ? <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">Nutrition by risk</h3><p className="text-sm text-muted-foreground">Guidance by NIQ risk category. “Any” applies across categories.</p></div><Button type="button" disabled={disabled || guidance.nutrition.length >= 30} onClick={() => startEdit("nutrition")}><Plus className="size-4" aria-hidden="true" /> Add intervention</Button></div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_10rem]"><label className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" aria-label="Search nutrition interventions" placeholder="Search nutrition guidance…" value={nutritionSearch} onChange={event => setNutritionSearch(event.target.value)} /></label><NativeSelect aria-label="Filter nutrition risk category" value={riskFilter} onChange={event => setRiskFilter(event.target.value)}><option value="all">All risk categories</option><option value="any">Any risk category</option>{riskCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect><NativeSelect aria-label="Filter nutrition status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></NativeSelect></div>
      <div className="overflow-x-auto rounded-lg border"><Table className="min-w-[38rem] table-fixed"><TableHeader><TableRow className="bg-primary/5"><TableHead className="w-[23%]">Intervention</TableHead><TableHead className="w-[19%]">Risk category</TableHead><TableHead className="w-[46%]">Guidance</TableHead><TableHead className="w-[12%] text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filteredNutrition.map(item => <TableRow key={item.id} className="even:bg-muted/20"><TableCell className="whitespace-normal align-top"><span className="font-medium">{item.label}</span>{!item.enabled && <span className="mt-1 block text-xs text-muted-foreground">Disabled</span>}</TableCell><TableCell className="whitespace-normal align-top">{riskName(item.riskCategoryId)}</TableCell><TableCell className="whitespace-normal align-top"><span className="line-clamp-2">{item.coreStrategy}</span><span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.clinicalActions}</span></TableCell><TableCell className="align-top"><div className="flex justify-end gap-1"><Button type="button" size="icon" variant="ghost" aria-label={`Edit ${item.label}`} disabled={disabled} onClick={() => startEdit("nutrition", item)}><Pencil className="size-4" aria-hidden="true" /></Button><Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`Delete ${item.label}`} disabled={disabled} onClick={() => setDeleting({ kind: "nutrition", id: item.id })}><Trash2 className="size-4" aria-hidden="true" /></Button></div></TableCell></TableRow>)}</TableBody></Table>{!filteredNutrition.length && <p className="p-5 text-sm text-muted-foreground">{guidance.nutrition.length ? "No interventions match these filters." : "No nutrition interventions in this version. Add an intervention to get started."}</p>}</div>
    </div> : <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">Drug-class toxicity</h3><p className="text-sm text-muted-foreground">Nutrition guidance matched by treatment, drug class, and a confirmed symptom or effect.</p></div><div className="flex flex-wrap gap-2">{suggestedCount > 0 && <Button type="button" variant="outline" disabled={disabled} onClick={fillSuggestedMatches}>Fill {suggestedCount} proposed matches</Button>}{updatedSuggestions.length > 0 && <Button type="button" variant="outline" disabled={disabled} onClick={applyUpdatedSuggestions}>Apply {updatedSuggestions.length} audited matches</Button>}<Button type="button" disabled={disabled || !drugClasses.length || guidance.toxicity.length >= 500} onClick={() => startEdit("toxicity")}><Plus className="size-4" aria-hidden="true" /> Add intervention</Button></div></div>
      <p className="text-xs text-muted-foreground">Assessment matches: {matchCounts.assessment} · Clinician confirmation: {matchCounts.clinician} · Needs mapping: {matchCounts.needsReview}. Proposed matches in a draft still require manual review before report use.</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_12rem_10rem]"><label className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" aria-label="Search toxicity interventions" placeholder="Search toxicity guidance…" value={toxicitySearch} onChange={event => setToxicitySearch(event.target.value)} /></label><NativeSelect aria-label="Filter toxicity drug class" value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="all">All drug classes</option>{drugClasses.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect><NativeSelect aria-label="Filter toxicity match" value={matchFilter} onChange={event => setMatchFilter(event.target.value)}><option value="all">All matches</option><option value="needs_review">Needs mapping</option><option value="assessment_answer">Assessment answer</option><option value="weight_change">Measured weight change</option><option value="clinician_confirmation">Clinician confirmation</option></NativeSelect><NativeSelect aria-label="Filter toxicity status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></NativeSelect></div>
      <div className="overflow-x-auto rounded-lg border"><Table className="min-w-[60rem] table-fixed"><TableHeader><TableRow className="bg-primary/5"><TableHead className="w-[16%]">Drug class</TableHead><TableHead className="w-[14%]">Treatment</TableHead><TableHead className="w-[18%]">Expected toxicity</TableHead><TableHead className="w-[18%]">When used</TableHead><TableHead className="w-[27%]">Nutrition intervention</TableHead><TableHead className="w-[7%] text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filteredToxicity.map(item => { const visible = classOnlyToxicity(item); return <TableRow key={item.id} className="even:bg-muted/20"><TableCell className="whitespace-normal align-top font-medium">{className(item.classId)}{!item.enabled && <span className="mt-1 block text-xs font-normal text-muted-foreground">Disabled</span>}</TableCell><TableCell className="whitespace-normal align-top">{treatmentName(item.treatmentTypeId)}</TableCell><TableCell className="whitespace-normal align-top"><span className="line-clamp-3">{visible.expectedToxicity}</span></TableCell><TableCell className="whitespace-normal align-top text-xs"><span className={!item.match ? "text-amber-700" : ""}>{toxicityMatchLabel(definition, item.match)}</span>{!item.match && <span className="mt-1 line-clamp-3 text-muted-foreground">Suggested: {suggestedMatchLabel(item)}</span>}</TableCell><TableCell className="whitespace-normal align-top"><span className="line-clamp-3">{visible.nutritionalInterventions}</span></TableCell><TableCell className="align-top"><div className="flex justify-end gap-1"><Button type="button" size="icon" variant="ghost" aria-label={`Edit ${className(item.classId)}: ${visible.expectedToxicity}`} disabled={disabled} onClick={() => startEdit("toxicity", item)}><Pencil className="size-4" aria-hidden="true" /></Button><Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`Delete ${className(item.classId)}: ${visible.expectedToxicity}`} disabled={disabled} onClick={() => setDeleting({ kind: "toxicity", id: item.id })}><Trash2 className="size-4" aria-hidden="true" /></Button></div></TableCell></TableRow>; })}</TableBody></Table>{!filteredToxicity.length && <p className="p-5 text-sm text-muted-foreground">{guidance.toxicity.length ? "No interventions match these filters." : "No toxicity interventions in this version. Add an intervention to get started."}</p>}</div>
    </div>}
    <p className="text-xs text-muted-foreground">Changes stay in this draft until you select Save draft below.</p>

    <Dialog open={editing !== null} onOpenChange={open => { if (!open) requestClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing?.isNew ? "Add" : "Edit"} {editing?.kind === "toxicity" ? "toxicity intervention" : "nutrition intervention"}</DialogTitle><DialogDescription>Define the guidance for this rule version.</DialogDescription></DialogHeader>{editing && <div className="space-y-4">
      {editing.kind === "nutrition" ? <>
        <Field label="Name"><Input autoFocus maxLength={200} value={editing.item.label} onChange={event => setEditing({ ...editing, item: { ...editing.item, label: event.target.value } })} /></Field>
        <Field label="NIQ risk category"><NativeSelect value={editing.item.riskCategoryId ?? "any"} onChange={event => setEditing({ ...editing, item: { ...editing.item, riskCategoryId: event.target.value === "any" ? null : event.target.value } })}><option value="any">Any risk category</option>{riskCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></Field>
        <Field label="Core strategy"><Textarea rows={3} maxLength={4000} value={editing.item.coreStrategy} onChange={event => setEditing({ ...editing, item: { ...editing.item, coreStrategy: event.target.value } })} /></Field>
        <Field label="Clinical actions"><Textarea rows={3} maxLength={8000} value={editing.item.clinicalActions} onChange={event => setEditing({ ...editing, item: { ...editing.item, clinicalActions: event.target.value } })} /></Field>
      </> : <>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Drug class"><NativeSelect value={editing.item.classId} onChange={event => setEditing({ ...editing, item: { ...editing.item, classId: event.target.value } })}><option value="">Select drug class</option>{drugClasses.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></Field><Field label="Treatment"><NativeSelect value={editing.item.treatmentTypeId} onChange={event => setEditing({ ...editing, item: { ...editing.item, treatmentTypeId: event.target.value } })}><option value="">Select treatment</option>{treatments.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></Field></div>
        <Field label="Expected toxicity"><Textarea rows={3} maxLength={200} value={editing.item.expectedToxicity} onChange={event => setEditing({ ...editing, item: { ...editing.item, expectedToxicity: event.target.value } })} /></Field>
        <Field label="Nutritional interventions"><Textarea rows={3} maxLength={8000} value={editing.item.nutritionalInterventions} onChange={event => setEditing({ ...editing, item: { ...editing.item, nutritionalInterventions: event.target.value } })} /></Field>
        <ToxicityMatchEditor definition={definition} match={editing.item.match} onChange={match => setEditing({ ...editing, item: { ...editing.item, match } })} />
        {reviewSuggestion && (!editing.item.match || (editing.item.match.mode === "clinician_confirmation" && reviewSuggestion.mode !== "clinician_confirmation")) && <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Suggested for review</p>
          <p>{toxicityMatchLabel(definition, reviewSuggestion)}</p>
          <p className="text-xs text-muted-foreground">A symptom answer does not prove its cause or severity. Check this row before applying the suggestion.</p>
          <Button type="button" variant="outline" onClick={() => setEditing({ ...editing, item: { ...editing.item, match: reviewSuggestion } })}>Use this suggestion</Button>
        </div>}
      </>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={editing.item.enabled} onChange={event => setEditing({ ...editing, item: { ...editing.item, enabled: event.target.checked } } as EditorState)} /><span>Enabled for this rule version</span></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}<DialogFooter><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="button" onClick={saveEdit}>{editing?.isNew ? "Add intervention" : "Save changes"}</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard changes?</AlertDialogTitle><AlertDialogDescription>Your edits in this dialog have not been applied to the rule draft.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={closeEdit}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={deleting !== null} onOpenChange={open => { if (!open) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete intervention?</AlertDialogTitle><AlertDialogDescription>This removes the row from this draft. Save the rule version to keep the change.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={remove}>Delete intervention</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
