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
import {
  Field,
  NutritionTargetExceptionsEditor,
  NutritionTargetFields,
  NutritionTargetSummary,
  parseTargetInputs,
  targetInputs,
  type TargetInputs,
} from "./NutritionTargetFields";
import { ToxicityWorkbookPanel } from "./ToxicityWorkbookPanel";

type Guidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;
type Nutrition = Guidance["nutrition"][number];
type EditorState = { item: Nutrition; isNew: boolean; targets: TargetInputs };
type Props = {
  definition: FinalAssessmentDefinition;
  disabled: boolean;
  onChange: (definition: FinalAssessmentDefinition) => void;
  onReferenceSelect: (id: string) => void;
};

const emptyGuidance: Guidance = { nutrition: [], toxicity: [] };
const newNutritionId = () => `nutrition_${crypto.randomUUID().replaceAll("-", "")}`;
const searchMatch = (query: string, ...values: string[]) => values.some(value => value.toLocaleLowerCase().includes(query));

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
  const hasLegacyGuidance = guidance.nutrition.some(item => !item.targets && item.coreStrategy && item.clinicalActions);
  const filteredNutrition = useMemo(() => guidance.nutrition.filter(item => {
    const query = nutritionSearch.trim().toLocaleLowerCase();
    return (riskFilter === "all" || (riskFilter === "any" ? item.riskCategoryId === null : item.riskCategoryId === riskFilter))
      && (statusFilter === "all" || item.enabled === (statusFilter === "enabled"))
      && (!query || searchMatch(query, item.label, riskName(item.riskCategoryId), item.coreStrategy ?? "", item.clinicalActions ?? "", item.proteinTargetNote ?? ""));
  }), [guidance.nutrition, nutritionSearch, riskFilter, statusFilter, riskCategories]);
  const change = (next: Guidance) => onChange({ ...definition, reportGuidance: next });
  const startEdit = (item?: Nutrition) => {
    setError("");
    const next: EditorState = {
      item: item ?? {
        id: newNutritionId(), label: "", riskCategoryId: null,
        enabled: true, source: { document: "Manual entry", location: "Rules editor", note: "" },
      },
      isNew: !item,
      targets: targetInputs(item?.targets),
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
    if (!item.label.trim()) {
      setError("Enter a name.");
      return;
    }
    if (item.riskCategoryId !== null && !riskCategories.some(category => category.id === item.riskCategoryId)) {
      setError("Select a configured risk category.");
      return;
    }
    if (item.enabled && guidance.nutrition.some(row => row.id !== item.id && row.enabled
      && item.riskCategoryId !== null && row.riskCategoryId === item.riskCategoryId)) {
      setError("An active intervention already covers this risk category.");
      return;
    }
    const targets = parseTargetInputs(editing.targets);
    const noTargetInputs = Object.values(editing.targets).every(range => !range.min.trim() && !range.max.trim());
    // Renaming or disabling a historical row should preserve its saved text.
    const legacyText = !item.targets && noTargetInputs && item.coreStrategy && item.clinicalActions
      ? { coreStrategy: item.coreStrategy, clinicalActions: item.clinicalActions }
      : undefined;
    if (!targets.success && !legacyText) {
      setError("For each daily target, enter a positive minimum and a maximum at least as large as the minimum.");
      return;
    }
    const clean: Nutrition = {
      id: item.id,
      label: item.label.trim(),
      riskCategoryId: item.riskCategoryId,
      enabled: item.enabled,
      ...(targets.success ? { targets: targets.data } : legacyText),
      proteinTargetNote: item.proteinTargetNote?.trim() || undefined,
      source: {
        document: item.source.document.trim() || "Manual entry",
        location: item.source.location.trim() || "Rules editor",
        note: item.source.note.trim(),
      },
    };
    change({ ...guidance, nutrition: editing.isNew
      ? [...guidance.nutrition, clean]
      : guidance.nutrition.map(row => row.id === clean.id ? clean : row) });
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
      <div className="overflow-x-auto rounded-lg border">
        <Table className={hasLegacyGuidance ? "min-w-[46rem] table-fixed" : "min-w-[36rem] table-fixed"}>
          <TableHeader><TableRow className="bg-primary/5">
            <TableHead className={hasLegacyGuidance ? "w-[21%]" : "w-[31%]"}>Intervention</TableHead>
            <TableHead className={hasLegacyGuidance ? "w-[14%]" : "w-[19%]"}>Risk category</TableHead>
            <TableHead className={hasLegacyGuidance ? "w-[22%]" : "w-[38%]"}>Daily targets</TableHead>
            {hasLegacyGuidance && <TableHead className="w-[31%]">Guidance</TableHead>}
            <TableHead className="w-[12%] text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>{filteredNutrition.map(item => (
            <TableRow key={item.id} className="even:bg-muted/20">
              <TableCell className="whitespace-normal align-top">
                <span className="font-medium">{item.label}</span>
                {!item.enabled && <span className="ml-1 block text-xs text-muted-foreground">Disabled</span>}
              </TableCell>
              <TableCell className="whitespace-normal align-top">{riskName(item.riskCategoryId)}</TableCell>
              <TableCell className="whitespace-normal align-top">
                {item.targets ? <NutritionTargetSummary targets={item.targets} /> : <span className="text-muted-foreground">—</span>}
                {item.proteinTargetNote && <p className="mt-1 text-xs text-muted-foreground">{item.proteinTargetNote}</p>}
              </TableCell>
              {hasLegacyGuidance && <TableCell className="whitespace-normal align-top">
                <span className="line-clamp-2">{item.coreStrategy}</span>
                <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.clinicalActions}</span>
              </TableCell>}
              <TableCell className="align-top">
                <div className="flex justify-end gap-1">
                  <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${item.label}`} disabled={disabled}
                    onClick={() => startEdit(item)}><Pencil className="size-4" aria-hidden="true" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`Delete ${item.label}`}
                    disabled={disabled} onClick={() => setDeletingId(item.id)}><Trash2 className="size-4" aria-hidden="true" /></Button>
                </div>
              </TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
        {!filteredNutrition.length && <p className="p-5 text-sm text-muted-foreground">
          {guidance.nutrition.length ? "No interventions match these filters." : "No nutrition interventions in this version. Add an intervention to get started."}
        </p>}
      </div>
      <NutritionTargetExceptionsEditor
        value={guidance.nutritionTargetExceptions}
        disabled={disabled}
        onChange={nutritionTargetExceptions => change({ ...guidance, nutritionTargetExceptions })}
      />
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
        <NutritionTargetFields fields={editing.targets} onChange={targets => setEditing({ ...editing, targets })} />
        <Field label="Protein target note"><Textarea rows={2} maxLength={1000} value={editing.item.proteinTargetNote ?? ""} onChange={event => setEditing({ ...editing, item: { ...editing.item, proteinTargetNote: event.target.value } })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={editing.item.enabled} onChange={event => setEditing({ ...editing, item: { ...editing.item, enabled: event.target.checked } })} /><span>Enabled for this rule version</span></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}<DialogFooter><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="button" onClick={saveEdit}>{editing?.isNew ? "Add intervention" : "Save changes"}</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard changes?</AlertDialogTitle><AlertDialogDescription>Your edits in this dialog have not been applied to the rule draft.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={closeEdit}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={deletingId !== null} onOpenChange={open => { if (!open) setDeletingId(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete intervention?</AlertDialogTitle><AlertDialogDescription>This removes the row from this draft. Save the rule version to keep the change.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={remove}>Delete intervention</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
