import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { emptyToxicityGuidance, TOXICITY_GUIDANCE_TREATMENTS } from "@niq-scoring/contracts/toxicity-workbook";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { NativeSelect } from "../components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { ToxicityWorkbookPanel } from "./ToxicityWorkbookPanel";

type Guidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;
type Nutrition = Guidance["nutrition"][number];
type EditorState = { item: Nutrition; isNew: boolean };
type Props = {
  definition: FinalAssessmentDefinition;
  disabled: boolean;
  onChange: (definition: FinalAssessmentDefinition) => void;
  onReferenceSelect: (id: string) => void;
};

const emptyGuidance: Guidance = { nutrition: [], toxicity: [] };
const newNutritionId = () => `nutrition_${crypto.randomUUID().replaceAll("-", "")}`;
const searchMatch = (query: string, ...values: string[]) => values.some(value => value.toLocaleLowerCase().includes(query));

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}

export function ReportGuidanceEditor({ definition, disabled, onChange, onReferenceSelect }: Props) {
  const guidance = definition.reportGuidance ?? emptyGuidance;
  const [section, setSection] = useState<"nutrition" | "toxicity">("nutrition");
  const [nutritionSearch, setNutritionSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [original, setOriginal] = useState<EditorState | null>(null);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const riskCategories = definition.riskCategories;
  const toxicityGuidance = guidance.toxicityWorkbook ?? emptyToxicityGuidance();
  const classes = new Map((definition.drugClassConfig?.classes ?? [])
    .filter(item => item.id !== "other").map(item => [item.id, item.label]));
  for (const rule of toxicityGuidance.rules) {
    if (rule.classId && !classes.has(rule.classId)) classes.set(rule.classId, rule.classLabel);
  }
  const drugClasses = Array.from(classes, ([id, label]) => ({ id, label }));
  const treatmentField = definition.sections.flatMap(item => item.fields)
    .find(item => item.id === "current_cancer_treatment");
  const treatments = TOXICITY_GUIDANCE_TREATMENTS.map(id => ({
    id,
    label: treatmentField && "options" in treatmentField
      ? treatmentField.options.find(option => option.id === id)?.label ?? id
      : id,
  }));
  const riskName = (id: string | null) => id === null ? "Any risk category" : riskCategories.find(item => item.id === id)?.label ?? id;
  const filteredNutrition = useMemo(() => guidance.nutrition.filter(item => {
    const query = nutritionSearch.trim().toLocaleLowerCase();
    return (riskFilter === "all" || (riskFilter === "any" ? item.riskCategoryId === null : item.riskCategoryId === riskFilter))
      && (statusFilter === "all" || item.enabled === (statusFilter === "enabled"))
      && (!query || searchMatch(query, item.label, riskName(item.riskCategoryId), item.coreStrategy, item.clinicalActions));
  }), [guidance.nutrition, nutritionSearch, riskFilter, statusFilter, riskCategories]);
  const change = (next: Guidance) => onChange({ ...definition, reportGuidance: next });
  const startEdit = (item?: Nutrition) => {
    setError("");
    const next: EditorState = {
      item: item ?? {
        id: newNutritionId(), label: "", riskCategoryId: null, coreStrategy: "", clinicalActions: "",
        enabled: true, source: { document: "Manual entry", location: "Rules editor", note: "" },
      },
      isNew: !item,
    };
    setEditing(next);
    setOriginal(structuredClone(next));
  };
  const closeEdit = () => { setConfirmClose(false); setEditing(null); setOriginal(null); setError(""); };
  const requestClose = () => {
    if (editing && original && JSON.stringify(editing) !== JSON.stringify(original)) setConfirmClose(true);
    else closeEdit();
  };
  const saveEdit = () => {
    if (!editing || disabled) return;
    const item = editing.item;
    if (!item.label.trim() || !item.coreStrategy.trim() || !item.clinicalActions.trim()) { setError("Enter a name, core strategy, and clinical actions."); return; }
    if (item.riskCategoryId !== null && !riskCategories.some(category => category.id === item.riskCategoryId)) { setError("Select a configured risk category."); return; }
    if (item.enabled && guidance.nutrition.some(row => row.id !== item.id && row.enabled && item.riskCategoryId !== null && row.riskCategoryId === item.riskCategoryId)) { setError("An active intervention already covers this risk category."); return; }
    const clean = {
      ...item,
      label: item.label.trim(),
      coreStrategy: item.coreStrategy.trim(),
      clinicalActions: item.clinicalActions.trim(),
      source: {
        document: item.source.document.trim() || "Manual entry",
        location: item.source.location.trim() || "Rules editor",
        note: item.source.note.trim(),
      },
    };
    change({ ...guidance, nutrition: editing.isNew ? [...guidance.nutrition, clean] : guidance.nutrition.map(row => row.id === clean.id ? clean : row) });
    closeEdit();
  };
  const remove = () => {
    if (!deletingId) return;
    change({ ...guidance, nutrition: guidance.nutrition.filter(item => item.id !== deletingId) });
    setDeletingId(null);
  };
  return <section className="min-w-0 space-y-5 rounded-2xl bg-card p-4 shadow-sm sm:p-6" aria-label="Report guidance">
    <h2 className="text-lg font-medium">Report nutrition guidance</h2>
    <div className="flex flex-wrap gap-2 border-b pb-3" aria-label="Guidance type">
      <Button type="button" variant={section === "nutrition" ? "default" : "outline"} onClick={() => setSection("nutrition")}>Nutrition by risk <span className="ml-1 opacity-75">{guidance.nutrition.length}</span></Button>
      <Button type="button" variant={section === "toxicity" ? "default" : "outline"} onClick={() => setSection("toxicity")}>Drug-class guidance <span className="ml-1 opacity-75">{toxicityGuidance.rules.length}</span></Button>
    </div>
    {section === "nutrition" ? <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">Nutrition by risk</h3><p className="text-sm text-muted-foreground">Guidance by NIQ risk category. “Any” applies across categories.</p></div><Button type="button" disabled={disabled || guidance.nutrition.length >= 30} onClick={() => startEdit()}><Plus className="size-4" aria-hidden="true" /> Add intervention</Button></div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_10rem]"><label className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" aria-label="Search nutrition interventions" placeholder="Search nutrition guidance…" value={nutritionSearch} onChange={event => setNutritionSearch(event.target.value)} /></label><NativeSelect aria-label="Filter nutrition risk category" value={riskFilter} onChange={event => setRiskFilter(event.target.value)}><option value="all">All risk categories</option><option value="any">Any risk category</option>{riskCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect><NativeSelect aria-label="Filter nutrition status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></NativeSelect></div>
      <div className="overflow-x-auto rounded-lg border"><Table className="min-w-[38rem] table-fixed"><TableHeader><TableRow className="bg-primary/5"><TableHead className="w-[23%]">Intervention</TableHead><TableHead className="w-[19%]">Risk category</TableHead><TableHead className="w-[46%]">Guidance</TableHead><TableHead className="w-[12%] text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filteredNutrition.map(item => <TableRow key={item.id} className="even:bg-muted/20"><TableCell className="whitespace-normal align-top"><span className="font-medium">{item.label}</span>{!item.enabled && <span className="mt-1 block text-xs text-muted-foreground">Disabled</span>}</TableCell><TableCell className="whitespace-normal align-top">{riskName(item.riskCategoryId)}</TableCell><TableCell className="whitespace-normal align-top"><span className="line-clamp-2">{item.coreStrategy}</span><span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.clinicalActions}</span></TableCell><TableCell className="align-top"><div className="flex justify-end gap-1"><Button type="button" size="icon" variant="ghost" aria-label={`Edit ${item.label}`} disabled={disabled} onClick={() => startEdit(item)}><Pencil className="size-4" aria-hidden="true" /></Button><Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`Delete ${item.label}`} disabled={disabled} onClick={() => setDeletingId(item.id)}><Trash2 className="size-4" aria-hidden="true" /></Button></div></TableCell></TableRow>)}</TableBody></Table>{!filteredNutrition.length && <p className="p-5 text-sm text-muted-foreground">{guidance.nutrition.length ? "No interventions match these filters." : "No nutrition interventions in this version. Add an intervention to get started."}</p>}</div>
    </div> : <ToxicityWorkbookPanel
      workbook={toxicityGuidance}
      disabled={disabled}
      onChange={toxicityWorkbook => change({ ...guidance, toxicity: [], toxicityWorkbook })}
      drugClasses={drugClasses}
      treatments={treatments}
      onReferenceSelect={onReferenceSelect}
    />}
    <p className="text-xs text-muted-foreground">Changes stay in this draft until you select Save draft below.</p>

    <Dialog open={editing !== null} onOpenChange={open => { if (!open) requestClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing?.isNew ? "Add" : "Edit"} nutrition intervention</DialogTitle><DialogDescription>Define the guidance for this rule version.</DialogDescription></DialogHeader>{editing && <div className="space-y-4">
        <Field label="Name"><Input autoFocus maxLength={200} value={editing.item.label} onChange={event => setEditing({ ...editing, item: { ...editing.item, label: event.target.value } })} /></Field>
        <Field label="NIQ risk category"><NativeSelect value={editing.item.riskCategoryId ?? "any"} onChange={event => setEditing({ ...editing, item: { ...editing.item, riskCategoryId: event.target.value === "any" ? null : event.target.value } })}><option value="any">Any risk category</option>{riskCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></Field>
        <Field label="Core strategy"><Textarea rows={3} maxLength={4000} value={editing.item.coreStrategy} onChange={event => setEditing({ ...editing, item: { ...editing.item, coreStrategy: event.target.value } })} /></Field>
        <Field label="Clinical actions"><Textarea rows={3} maxLength={8000} value={editing.item.clinicalActions} onChange={event => setEditing({ ...editing, item: { ...editing.item, clinicalActions: event.target.value } })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={editing.item.enabled} onChange={event => setEditing({ ...editing, item: { ...editing.item, enabled: event.target.checked } })} /><span>Enabled for this rule version</span></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}<DialogFooter><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="button" onClick={saveEdit}>{editing?.isNew ? "Add intervention" : "Save changes"}</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard changes?</AlertDialogTitle><AlertDialogDescription>Your edits in this dialog have not been applied to the rule draft.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={closeEdit}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={deletingId !== null} onOpenChange={open => { if (!open) setDeletingId(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete intervention?</AlertDialogTitle><AlertDialogDescription>This removes the row from this draft. Save the rule version to keep the change.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={remove}>Delete intervention</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
