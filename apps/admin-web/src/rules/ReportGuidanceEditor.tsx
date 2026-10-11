import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { NativeSelect } from "../components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

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

  const filteredNutrition = useMemo(() => guidance.nutrition.filter(item => {
    const query = nutritionSearch.trim().toLocaleLowerCase();
    return (riskFilter === "all" || (riskFilter === "any" ? item.riskCategoryId === null : item.riskCategoryId === riskFilter))
      && (statusFilter === "all" || item.enabled === (statusFilter === "enabled"))
      && (!query || searchMatch(query, item.label, riskName(item.riskCategoryId), item.coreStrategy, item.clinicalActions));
  }), [guidance.nutrition, nutritionSearch, riskFilter, statusFilter, riskCategories]);
  const filteredToxicity = useMemo(() => guidance.toxicity.filter(item => {
    const query = toxicitySearch.trim().toLocaleLowerCase();
    return (classFilter === "all" || item.classId === classFilter)
      && (statusFilter === "all" || item.enabled === (statusFilter === "enabled"))
      && (!query || searchMatch(query, className(item.classId), treatmentName(item.treatmentTypeId), item.expectedToxicity, item.nutritionalInterventions));
  }), [guidance.toxicity, toxicitySearch, classFilter, statusFilter, drugClasses, treatments]);

  const change = (next: Guidance) => onChange({ ...definition, reportGuidance: next });
  const startEdit = (kind: "nutrition" | "toxicity", item?: Nutrition | Toxicity) => {
    setError("");
    const next: EditorState = kind === "nutrition"
      ? { kind, item: item as Nutrition ?? { id: newId(kind), label: "", riskCategoryId: null, coreStrategy: "", clinicalActions: "", enabled: true, source: { document: "Manual entry", location: "Rules editor", note: "" } }, isNew: !item }
      : { kind, item: item as Toxicity ?? { id: newId(kind), classId: "", treatmentTypeId: "", expectedToxicity: "", nutritionalInterventions: "", enabled: true, requiresDrugConfirmation: false, source: { document: "Manual entry", location: "Rules editor", note: "" } }, isNew: !item };
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
      const item = editing.item;
      if (!drugClasses.some(drugClass => drugClass.id === item.classId) || !treatments.some(treatment => treatment.id === item.treatmentTypeId)) { setError("Select a configured drug class and treatment."); return; }
      if (!item.expectedToxicity.trim() || !item.nutritionalInterventions.trim()) { setError("Enter an expected toxicity and nutritional intervention."); return; }
      if (item.enabled && guidance.toxicity.some(row => row.id !== item.id && row.enabled && row.classId === item.classId && row.treatmentTypeId === item.treatmentTypeId && row.expectedToxicity.trim().toLocaleLowerCase() === item.expectedToxicity.trim().toLocaleLowerCase())) { setError("An active intervention already covers this class, treatment, and toxicity."); return; }
      if (Boolean(item.classLevelToxicity?.trim()) !== Boolean(item.classLevelInterventions?.trim())) { setError("Enter both class-level fields, or leave both empty."); return; }
      const clean = { ...item, expectedToxicity: item.expectedToxicity.trim(), nutritionalInterventions: item.nutritionalInterventions.trim(),
        classLevelToxicity: item.classLevelToxicity?.trim() || undefined, classLevelInterventions: item.classLevelInterventions?.trim() || undefined,
        source };
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
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">Drug-class toxicity</h3><p className="text-sm text-muted-foreground">Class-level entries from the oncology guide. Rows mentioning a named drug use the class-level wording in report guidance.</p></div><Button type="button" disabled={disabled || !drugClasses.length || guidance.toxicity.length >= 500} onClick={() => startEdit("toxicity")}><Plus className="size-4" aria-hidden="true" /> Add intervention</Button></div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_10rem]"><label className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" aria-label="Search toxicity interventions" placeholder="Search toxicity guidance…" value={toxicitySearch} onChange={event => setToxicitySearch(event.target.value)} /></label><NativeSelect aria-label="Filter toxicity drug class" value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="all">All drug classes</option>{drugClasses.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect><NativeSelect aria-label="Filter toxicity status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></NativeSelect></div>
      <div className="overflow-x-auto rounded-lg border"><Table className="min-w-[45rem] table-fixed"><TableHeader><TableRow className="bg-primary/5"><TableHead className="w-[19%]">Drug class</TableHead><TableHead className="w-[17%]">Treatment</TableHead><TableHead className="w-[22%]">Expected toxicity</TableHead><TableHead className="w-[33%]">Nutrition intervention</TableHead><TableHead className="w-[9%] text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filteredToxicity.map(item => <TableRow key={item.id} className="even:bg-muted/20"><TableCell className="whitespace-normal align-top font-medium">{className(item.classId)}{!item.enabled && <span className="mt-1 block text-xs font-normal text-muted-foreground">Disabled</span>}</TableCell><TableCell className="whitespace-normal align-top">{treatmentName(item.treatmentTypeId)}</TableCell><TableCell className="whitespace-normal align-top"><span className="line-clamp-3">{item.expectedToxicity}</span>{item.requiresDrugConfirmation && <span className="mt-1 block text-xs text-amber-700">Class-level wording for reports</span>}</TableCell><TableCell className="whitespace-normal align-top"><span className="line-clamp-3">{item.nutritionalInterventions}</span></TableCell><TableCell className="align-top"><div className="flex justify-end gap-1"><Button type="button" size="icon" variant="ghost" aria-label={`Edit ${className(item.classId)}: ${item.expectedToxicity}`} disabled={disabled} onClick={() => startEdit("toxicity", item)}><Pencil className="size-4" aria-hidden="true" /></Button><Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`Delete ${className(item.classId)}: ${item.expectedToxicity}`} disabled={disabled} onClick={() => setDeleting({ kind: "toxicity", id: item.id })}><Trash2 className="size-4" aria-hidden="true" /></Button></div></TableCell></TableRow>)}</TableBody></Table>{!filteredToxicity.length && <p className="p-5 text-sm text-muted-foreground">{guidance.toxicity.length ? "No interventions match these filters." : "No toxicity interventions in this version. Add an intervention to get started."}</p>}</div>
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
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={editing.item.requiresDrugConfirmation} onChange={event => setEditing({ ...editing, item: { ...editing.item, requiresDrugConfirmation: event.target.checked, ...(event.target.checked ? {} : { classLevelToxicity: undefined, classLevelInterventions: undefined }) } })} /><span><span className="font-medium">Source wording names an individual drug</span><span className="block text-muted-foreground">Use the class-level wording below in reports. Keep the source text here for reference.</span></span></label>
        {editing.item.requiresDrugConfirmation && <div className="space-y-3 rounded-lg border p-3"><p className="text-sm text-muted-foreground">Optional class-level wording shown when the toxicity is confirmed but the named drug is not. Leave both empty to withhold this row.</p><Field label="Class-level toxicity"><Input maxLength={200} value={editing.item.classLevelToxicity ?? ""} onChange={event => setEditing({ ...editing, item: { ...editing.item, classLevelToxicity: event.target.value } })} /></Field><Field label="Class-level intervention"><Textarea rows={3} maxLength={8000} value={editing.item.classLevelInterventions ?? ""} onChange={event => setEditing({ ...editing, item: { ...editing.item, classLevelInterventions: event.target.value } })} /></Field></div>}
      </>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={editing.item.enabled} onChange={event => setEditing({ ...editing, item: { ...editing.item, enabled: event.target.checked } } as EditorState)} /><span>Enabled for this rule version</span></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}<DialogFooter><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="button" onClick={saveEdit}>{editing?.isNew ? "Add intervention" : "Save changes"}</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard changes?</AlertDialogTitle><AlertDialogDescription>Your edits in this dialog have not been applied to the rule draft.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={closeEdit}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={deleting !== null} onOpenChange={open => { if (!open) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete intervention?</AlertDialogTitle><AlertDialogDescription>This removes the row from this draft. Save the rule version to keep the change.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={remove}>Delete intervention</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
