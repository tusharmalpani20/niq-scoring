import { useId, useRef, useState } from "react";
import { ChevronsUpDown, Globe2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { initialDrugClassConfig } from "@niq-scoring/contracts/drug-class-template";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { cancerTypeChoices } from "./cancer-type-choices";
import { assessmentOptionIcon } from "./assessment-icons/assessmentOptionIcon";

type Config = NonNullable<FinalAssessmentDefinition["drugClassConfig"]>;
type DrugClass = Config["classes"][number];
type Choice = { id: string; label: string };
type EditState = {
  id: string; isNew: boolean; label: string; guidance: string;
  cancers: string[]; treatments: string[]; mappingsTouched: boolean;
};
type Props = { definition: FinalAssessmentDefinition; disabled: boolean; onChange: (definition: FinalAssessmentDefinition) => void };
const ANY_CANCER = "__any_cancer__";

function choiceIcon(kind: "cancer_type" | "current_cancer_treatment", id: string) {
  return id === ANY_CANCER ? <Globe2 aria-hidden="true" /> : assessmentOptionIcon(kind, id);
}

function chips(items: Choice[], kind: "cancer_type" | "current_cancer_treatment") {
  if (!items.length) return <span className="text-muted-foreground">Search only</span>;
  return <div className="flex flex-wrap gap-1.5">{items.map(item => <span key={item.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs"><span className="shrink-0 text-primary [&_svg]:size-3.5">{choiceIcon(kind, item.id)}</span><span className="min-w-0 break-words">{item.label}</span></span>)}</div>;
}

function SearchableMultiSelect({ label, kind, options, selected, onChange }: { label: string; kind: "cancer_type" | "current_cancer_treatment"; options: Choice[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const visible = options.filter(option => !selected.includes(option.id) && option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = (id: string) => {
    onChange([...selected, id]);
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
    setOpen(false);
  };
  return <div className="min-w-0 space-y-2">
    <p className="text-sm font-medium">{label}</p>
    {selected.length > 0 && <div className="flex min-w-0 flex-wrap gap-1.5" aria-label={`Selected ${label.toLowerCase()}`}>
      {selected.map(id => {
        const name = options.find(option => option.id === id)?.label ?? id;
        return <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2 pr-1 text-xs">
          <span className="shrink-0 text-primary [&_svg]:size-3.5">{choiceIcon(kind, id)}</span>
          <span className="min-w-0 break-words">{name}</span>
          <button type="button" className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Remove ${name} from ${label.toLowerCase()}`} onClick={() => onChange(selected.filter(value => value !== id))}><X className="size-3" aria-hidden="true" /></button>
        </span>;
      })}
    </div>}
    <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(""); setActiveIndex(0); } }}>
      <div className="flex min-h-10 min-w-0 items-center rounded-md border bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <Input ref={inputRef} role="combobox" aria-label={`Add ${label.toLowerCase()}`} aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && visible[activeIndex] ? `${listId}-${visible[activeIndex].id}` : undefined} autoComplete="off" placeholder={`Search or select ${label.toLowerCase()}…`} value={query} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }} onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex(index => Math.min(index + 1, Math.max(visible.length - 1, 0))); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => Math.max(index - 1, 0)); }
            else if (event.key === "Enter" && open && visible[activeIndex]) { event.preventDefault(); choose(visible[activeIndex].id); }
            else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(""); }
          }} className="min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0" />
          <button type="button" className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`Show ${label.toLowerCase()} options`} aria-expanded={open} onClick={() => { const next = !open; inputRef.current?.focus(); setOpen(next); if (!next) setQuery(""); }}><ChevronsUpDown className="size-4" aria-hidden="true" /></button>
      </div>
      {open && <div className="mt-1 rounded-md border bg-popover p-1.5 text-popover-foreground shadow-md">
          <div id={listId} role="listbox" aria-label={label} className="max-h-40 space-y-0.5 overflow-y-auto">
            {visible.length ? visible.map((option, index) => <button key={option.id} id={`${listId}-${option.id}`} type="button" role="option" aria-selected={false} className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${index === activeIndex ? "bg-primary/10" : "hover:bg-muted/60"}`} onClick={() => choose(option.id)}>
              <span className="shrink-0 text-primary [&_svg]:size-4">{choiceIcon(kind, option.id)}</span><span className="min-w-0 break-words">{option.label}</span>
            </button>) : <p className="px-2 py-2 text-sm text-muted-foreground">{query ? "No matching options" : "All options selected"}</p>}
          </div>
      </div>}
    </div>
  </div>;
}

export function DrugClassEditor({ definition, disabled, onChange }: Props) {
  const config: Config = definition.drugClassConfig ?? { classes: [], suggestions: [] };
  const treatmentOptions = definition.sections.flatMap(section => section.fields)
    .filter(field => field.id === "current_cancer_treatment" && "options" in field)
    .flatMap(field => "options" in field ? field.options.map(option => ({ id: option.id, label: option.label })) : []);
  const cancerOptions: Choice[] = [{ id: ANY_CANCER, label: "Any cancer type" }, ...cancerTypeChoices.map(([id, label]) => ({ id, label }))];
  const [editing, setEditing] = useState<EditState | null>(null);
  const [initialEdit, setInitialEdit] = useState<EditState | null>(null);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [editError, setEditError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const change = (next: Config) => onChange({ ...definition, drugClassConfig: next });

  const openEdit = (drugClass: DrugClass | null) => {
    const mappings = config.suggestions.filter(item => item.classId === drugClass?.id);
    setEditError("");
    const next: EditState = {
      id: drugClass?.id ?? `drug_class_${crypto.randomUUID().replaceAll("-", "")}`,
      isNew: !drugClass,
      label: drugClass?.label ?? "",
      guidance: drugClass?.guidance ?? "",
      cancers: [...new Set(mappings.map(item => item.cancerTypeId ?? ANY_CANCER))],
      treatments: [...new Set(mappings.map(item => item.treatmentTypeId))],
      mappingsTouched: false,
    };
    setInitialEdit(next);
    setGuidanceOpen(Boolean(next.guidance.trim()));
    setEditing(next);
  };
  const discardEdit = () => { setConfirmClose(false); setEditing(null); setInitialEdit(null); };
  const requestClose = () => {
    if (!editing) return;
    if (initialEdit && (editing.label !== initialEdit.label || editing.guidance !== initialEdit.guidance || editing.mappingsTouched)) setConfirmClose(true);
    else discardEdit();
  };
  const saveEdit = () => {
    if (!editing) return;
    const label = editing.label.trim();
    if (!label) { setEditError("Enter a drug class name."); return; }
    if (config.classes.some(item => item.id !== editing.id && item.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) {
      setEditError("A drug class with this name already exists."); return;
    }
    if (editing.treatments.length && !editing.cancers.length) { setEditError("Select a cancer type or Any cancer type."); return; }
    const otherSuggestions = config.suggestions.filter(item => item.classId !== editing.id);
    if (editing.mappingsTouched && otherSuggestions.length + editing.treatments.length * editing.cancers.length > 2000) {
      setEditError("Too many suggestions for this rule version. Choose fewer combinations."); return;
    }
    const classes = editing.isNew
      ? [...config.classes, { id: editing.id, label, ...(editing.guidance.trim() ? { guidance: editing.guidance.trim() } : {}) }]
      : config.classes.map(item => item.id === editing.id ? { ...item, label, guidance: editing.guidance.trim() } : item);
    // Keep existing pairs intact when only the name or guidance was edited.
    const suggestions = editing.mappingsTouched ? [
      ...otherSuggestions,
      ...editing.treatments.flatMap(treatmentTypeId => editing.cancers.map(cancerTypeId => ({
        classId: editing.id, treatmentTypeId, cancerTypeId: cancerTypeId === ANY_CANCER ? null : cancerTypeId,
      }))),
    ] : config.suggestions;
    change({ classes, suggestions });
    setEditing(null);
    setInitialEdit(null);
  };
  const deleteClass = () => {
    if (!deleteId) return;
    onChange({
      ...definition,
      drugClassConfig: { classes: config.classes.filter(item => item.id !== deleteId), suggestions: config.suggestions.filter(item => item.classId !== deleteId) },
      reportGuidance: definition.reportGuidance && {
        ...definition.reportGuidance,
        toxicity: definition.reportGuidance.toxicity.filter(item => item.classId !== deleteId),
      },
    });
    setDeleteId(null);
  };

  return <section className="min-w-0 space-y-4 rounded-2xl bg-card p-4 shadow-sm sm:p-6" aria-label="Drug classes">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-medium">Drug classes</h2><p className="mt-1 text-sm text-muted-foreground">Suggestions guide the initial picker. Clinicians can search all classes, and classes add no NIQ points.</p></div>
      <div className="flex flex-wrap gap-2">
        {config.classes.length > 0 && !config.classes.some(item => item.id === "other") && <Button type="button" variant="outline" disabled={disabled || config.classes.length >= 200} onClick={() => change({ ...config, classes: [...config.classes, { id: "other", label: "Other" }] })}>Add Other option</Button>}
        <Button type="button" disabled={disabled || config.classes.length >= 200} onClick={() => openEdit(null)}><Plus className="size-4" aria-hidden="true" /> Add drug class</Button>
      </div>
    </div>
    {!config.classes.length ? <div className="space-y-2 rounded-xl border border-dashed p-4"><p className="text-sm text-muted-foreground">This version has no drug classes yet.</p><Button type="button" variant="outline" disabled={disabled} onClick={() => change(initialDrugClassConfig())}>Restore default drug classes</Button></div> :
      <Table className="min-w-[42rem] table-fixed">
        <TableHeader><TableRow className="bg-primary/5"><TableHead className="w-[25%]">Drug class</TableHead><TableHead className="w-[30%]">Cancer types</TableHead><TableHead className="w-[30%]">Treatments</TableHead><TableHead className="w-[15%] text-right">Actions</TableHead></TableRow></TableHeader>
        <TableBody>{config.classes.map(drugClass => {
          const mappings = config.suggestions.filter(item => item.classId === drugClass.id);
          const cancers = [...new Set(mappings.map(item => item.cancerTypeId ?? ANY_CANCER))].map(id => cancerOptions.find(option => option.id === id) ?? { id, label: id });
          const treatments = [...new Set(mappings.map(item => item.treatmentTypeId))].map(id => treatmentOptions.find(option => option.id === id) ?? { id, label: id });
          return <TableRow key={drugClass.id} className="even:bg-muted/20 hover:bg-primary/5">
            <TableCell className="whitespace-normal break-words align-top"><span className="font-medium">{drugClass.label}</span>{drugClass.id === "other" ? <span className="mt-1 block text-xs text-muted-foreground">Generic nutrition guidance only</span> : drugClass.guidance?.trim() && <span className="mt-1 block text-xs text-muted-foreground">Report guidance added</span>}</TableCell>
            <TableCell className="whitespace-normal align-top">{chips(cancers, "cancer_type")}</TableCell>
            <TableCell className="whitespace-normal align-top">{chips(treatments, "current_cancer_treatment")}</TableCell>
            <TableCell className="align-top"><div className="flex justify-end gap-1">
              <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${drugClass.label}`} disabled={disabled || drugClass.id === "other"} onClick={() => openEdit(drugClass)}><Pencil className="size-4" aria-hidden="true" /></Button>
              <Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`Delete ${drugClass.label}`} disabled={disabled || drugClass.id === "other"} onClick={() => setDeleteId(drugClass.id)}><Trash2 className="size-4" aria-hidden="true" /></Button>
            </div></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>}
    <Dialog open={editing !== null} onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent className="overflow-y-auto" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
        <DialogHeader><DialogTitle>{editing?.isNew ? "Add drug class" : `Edit ${editing?.label}`}</DialogTitle><DialogDescription className="sr-only">Edit the drug class and its suggested cancer and treatment types.</DialogDescription></DialogHeader>
        {editing && <div className="space-y-3">
          <label className="block space-y-1 text-sm"><span className="font-medium">Class name</span><Input autoFocus maxLength={200} value={editing.label} onChange={event => setEditing({ ...editing, label: event.target.value })} /></label>
          {guidanceOpen ? <label className="block space-y-1 text-sm"><span className="font-medium">Report guidance (optional)</span><Textarea rows={2} maxLength={4000} value={editing.guidance} onChange={event => setEditing({ ...editing, guidance: event.target.value })} /></label> : <Button type="button" variant="link" className="h-auto justify-start px-0 text-sm" onClick={() => setGuidanceOpen(true)}>Add report guidance (optional)</Button>}
          <div className="min-w-0 space-y-3">
            <SearchableMultiSelect key={`${editing.id}-cancers`} label="Cancer types" kind="cancer_type" options={cancerOptions} selected={editing.cancers} onChange={cancers => {
              const added = cancers.find(id => !editing.cancers.includes(id));
              setEditing({ ...editing, cancers: added === ANY_CANCER ? [ANY_CANCER] : added ? cancers.filter(id => id !== ANY_CANCER) : cancers, mappingsTouched: true });
            }} />
            <SearchableMultiSelect key={`${editing.id}-treatments`} label="Treatment types" kind="current_cancer_treatment" options={treatmentOptions} selected={editing.treatments} onChange={treatments => setEditing({ ...editing, treatments, mappingsTouched: true })} />
          </div>
          {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
        </div>}
        <DialogFooter><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="button" onClick={saveEdit}>{editing?.isNew ? "Add class" : "Save changes"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard changes to this drug class?</AlertDialogTitle><AlertDialogDescription>Your edits in this dialog have not been applied to the rule draft.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={discardEdit}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete drug class?</AlertDialogTitle><AlertDialogDescription>This removes the class, its suggestions, and its toxicity interventions from this draft. Save the rule version to keep the change.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={deleteClass}>Delete class</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </section>;
}
