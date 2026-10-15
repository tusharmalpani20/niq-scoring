import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { RADIOTHERAPY_TREATMENT_ID, type CarePlanGuidance, type NutritionalStatus } from "@niq-scoring/contracts/care-plan-guidance";
import { guidancePresentationText } from "@niq-scoring/contracts/guidance-presentation";
import { defaultProductExceptionAction, productDurationDays, productDurationText, productPlanItems, productPlanSnapshot } from "@niq-scoring/contracts/product-guidance";
import { ProductPlanCart } from "./ProductPlanCart";
import { ProductExceptionEditor, conflictingException, exceptionMatch, exceptionOptions, exceptionPreview, validateException } from "./ProductExceptionEditor";
import { request, message } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { NativeSelect } from "../components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";

type Props = { definition: FinalAssessmentDefinition; disabled: boolean; onChange: (definition: FinalAssessmentDefinition) => void };
type Section = "mapping" | "statusModifiers" | "radiotherapy" | "plans" | "comorbidities" | "notes";
type Oncology = CarePlanGuidance["oncology"];
type Products = CarePlanGuidance["products"];
type Entry =
  | { kind: "statusModifiers"; item: Oncology["statusModifiers"][number]; isNew: boolean }
  | { kind: "radiotherapy"; item: Oncology["radiotherapy"][number]; isNew: boolean }
  | { kind: "plans"; item: Products["plans"][number]; isNew: boolean }
  | { kind: "comorbidities"; item: Products["comorbidities"][number]; isNew: boolean }
  | { kind: "notes"; item: Products["notes"][number]; isNew: boolean };
type Row = Entry["item"];
const statusLabels: Record<NutritionalStatus, string> = {
  well_nourished: "Well nourished",
  moderately_nourished: "Moderately nourished",
  severely_malnourished: "Severely malnourished",
};
const stages: Products["plans"][number]["stage"][] = ["pre_conditioning", "during_treatment", "post_treatment", "surgical"];
const stageLabels: Record<Products["plans"][number]["stage"], string> = {
  pre_conditioning: "Before treatment", during_treatment: "During treatment", post_treatment: "After treatment", surgical: "After surgery",
};
const source = { document: "Manual entry", location: "Rules editor", note: "" };
const id = (kind: Section) => `${kind}_${crypto.randomUUID().replaceAll("-", "")}`;
const statusOptions = (value: NutritionalStatus, change: (next: NutritionalStatus) => void) =>
  <NativeSelect value={value} onChange={event => change(event.target.value as NutritionalStatus)}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect>;
const Field = ({ label, children }: { label: string; children: React.ReactNode }) =>
  <label className="block min-w-0 space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;

export function CarePlanGuidanceEditor({ definition, disabled, onChange }: Props) {
  const guidance = definition.carePlanGuidance;
  const [section, setSection] = useState<Section>("mapping");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [original, setOriginal] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleting, setDeleting] = useState<{ kind: Exclude<Section, "mapping">; id: string } | null>(null);
  const [catalog, setCatalog] = useState<Array<{ id: string; name: string; aliases: string[] }>>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRetry, setCatalogRetry] = useState(0);
  useEffect(() => {
    if (section !== "plans" && section !== "notes") return;
    let current = true;
    setCatalogError("");
    void request<{ products: Array<{ id: string; name: string; aliases: string[] }> }>("/admin/products")
      .then(result => { if (current) setCatalog(result.products); })
      .catch(cause => { if (current) setCatalogError(message(cause)); });
    return () => { current = false; };
  }, [section, catalogRetry]);
  const classes = definition.drugClassConfig?.classes.filter(item => item.id !== "other") ?? [];
  const fields = definition.sections.flatMap(item => item.fields);
  const options = (fieldId: string) => fields.filter(field => field.id === fieldId && "options" in field)
    .flatMap(field => "options" in field ? field.options : []);
  const treatments = options("current_cancer_treatment");
  const conditions = options("co_morbidities");
  const surgeryOptions = options("cancer_surgical_status");
  const lookup = (items: Array<{ id: string; label: string }>, key: string) => items.find(item => item.id === key)?.label ?? key;
  const update = (next: CarePlanGuidance) => onChange({ ...definition, carePlanGuidance: next });
  const rows = guidance ? section === "statusModifiers" ? guidance.oncology.statusModifiers
    : section === "radiotherapy" ? guidance.oncology.radiotherapy
    : section === "plans" ? guidance.products.plans
    : section === "comorbidities" ? guidance.products.comorbidities
    : section === "notes" ? guidance.products.notes : [] : [];
  const filtered = useMemo(() => rows.filter(row => !query.trim() || JSON.stringify(row).toLowerCase().includes(query.trim().toLowerCase())), [rows, query]);

  const changeRow = (kind: Exclude<Section, "mapping">, next: Row, isNew: boolean) => {
    if (!guidance) return;
    if (kind === "statusModifiers") {
      const item = next as Oncology["statusModifiers"][number];
      update({ ...guidance, oncology: { ...guidance.oncology, statusModifiers: isNew ? [...guidance.oncology.statusModifiers, item] : guidance.oncology.statusModifiers.map(row => row.id === item.id ? item : row) } });
    } else if (kind === "radiotherapy") {
      const item = next as Oncology["radiotherapy"][number];
      update({ ...guidance, oncology: { ...guidance.oncology, radiotherapy: isNew ? [...guidance.oncology.radiotherapy, item] : guidance.oncology.radiotherapy.map(row => row.id === item.id ? item : row) } });
    } else if (kind === "plans") {
      const item = next as Products["plans"][number];
      update({ ...guidance, products: { ...guidance.products, plans: isNew ? [...guidance.products.plans, item] : guidance.products.plans.map(row => row.id === item.id ? item : row) } });
    } else if (kind === "comorbidities") {
      const item = next as Products["comorbidities"][number];
      update({ ...guidance, products: { ...guidance.products, comorbidities: isNew ? [...guidance.products.comorbidities, item] : guidance.products.comorbidities.map(row => row.id === item.id ? item : row) } });
    } else {
      const item = next as Products["notes"][number];
      update({ ...guidance, products: { ...guidance.products, notes: isNew ? [...guidance.products.notes, item] : guidance.products.notes.map(row => row.id === item.id ? item : row) } });
    }
  };
  const start = (kind: Exclude<Section, "mapping">, item?: Row) => {
    const newItem: Row = kind === "statusModifiers" ? { id: id(kind), classId: classes[0]?.id ?? "", treatmentTypeId: treatments[0]?.id ?? "", nutritionalStatus: "well_nourished", riskEmphasis: "", actions: "", enabled: true, source }
      : kind === "radiotherapy" ? { id: id(kind), treatmentTypeId: treatments.find(row => row.id !== RADIOTHERAPY_TREATMENT_ID)?.id ?? treatments[0]?.id ?? "", nutritionalStatus: "well_nourished", guidance: "", enabled: true, source }
      : kind === "plans" ? { id: id(kind), stage: "pre_conditioning", nutritionalStatus: "well_nourished", products: "", dose: "", duration: "", enabled: true, source }
      : kind === "comorbidities" ? { id: id(kind), conditionId: conditions[0]?.id ?? "", label: "", guidance: "", sourceText: "Manual entry", enabled: true, source }
      : { id: id(kind), kind: "custom", match: { fieldId: "cancer_type", optionId: "" }, label: "", guidance: "", sourceText: "Manual entry", enabled: true, source };
    const copy = structuredClone(item ?? newItem);
    if (kind === "radiotherapy") (copy as Oncology["radiotherapy"][number]).treatmentTypeId ??= RADIOTHERAPY_TREATMENT_ID;
    if (kind === "plans") {
      const plan = copy as Products["plans"][number];
      plan.durationAmount = productDurationDays(plan) ?? undefined;
    }
    if (kind === "notes") {
      const row = copy as Products["notes"][number];
      row.match = exceptionMatch(row);
      row.action ??= defaultProductExceptionAction(row.kind) ?? undefined;
      if (item) row.label ||= exceptionOptions(row.match.fieldId, surgeryOptions).find(option => option.id === row.match?.optionId)?.label ?? "";
    }
    if ("guidance" in copy) copy.guidance = guidancePresentationText(copy.guidance);
    const entry = { kind, item: copy, isNew: !item } as Entry;
    setEditing(entry); setOriginal(structuredClone(entry)); setError("");
  };
  const close = () => { setEditing(null); setOriginal(null); setError(""); setConfirmClose(false); };
  const requestClose = () => editing && original && JSON.stringify(editing) !== JSON.stringify(original) ? setConfirmClose(true) : close();
  const patch = (change: Partial<Row>) => setEditing(current => current ? { ...current, item: { ...current.item, ...change } } as Entry : current);
  const save = () => {
    if (!editing) return;
    const item = editing.item;
    const fieldsToCheck = editing.kind === "statusModifiers" ? ["classId", "treatmentTypeId", "riskEmphasis", "actions"]
      : editing.kind === "radiotherapy" ? ["treatmentTypeId", "guidance"]
      : editing.kind === "plans" ? ["products", "dose", "duration"]
      : editing.kind === "notes" ? ["label"] : ["label", "guidance"];
    if (fieldsToCheck.some(key => !String((item as unknown as Record<string, unknown>)[key] ?? "").trim())) {
      setError("Complete all fields before saving this rule."); return;
    }
    if (editing.kind === "plans" && (!Number.isInteger(editing.item.durationAmount) || !editing.item.durationAmount || editing.item.durationAmount < 1 || editing.item.durationAmount > 3650)) {
      setError("Enter a whole number of days for the duration."); return;
    }
    const planItems = editing.kind === "plans" ? productPlanItems(editing.item) : [];
    if (editing.kind === "plans" && (!planItems.length || planItems.some(row =>
      row.quantityPerDay === undefined || !Number.isInteger(row.quantityPerDay) || row.quantityPerDay < 1 || row.quantityPerDay > 100))) {
      setError("Enter a quantity from 1 to 100 for every product."); return;
    }
    if (editing.kind === "statusModifiers" && (!classes.some(row => row.id === editing.item.classId) || !treatments.some(row => row.id === editing.item.treatmentTypeId))) {
      setError("Choose a configured drug class and treatment."); return;
    }
    if (editing.kind === "radiotherapy" && !treatments.some(row => row.id === editing.item.treatmentTypeId)) {
      setError("Choose a configured treatment type."); return;
    }
    if (editing.kind === "comorbidities" && !conditions.some(row => row.id === editing.item.conditionId)) {
      setError("Choose a configured co-morbidity."); return;
    }
    if (editing.kind === "notes") {
      const problem = validateException(editing.item, catalog, surgeryOptions);
      if (problem) { setError(problem); return; }
      const conflict = conflictingException(editing.item, guidance?.products.notes ?? []);
      if (conflict) { setError(`Conflicts with “${conflict.label}”: both rules change the same product for this assessment answer.`); return; }
    }
    changeRow(editing.kind, editing.item, editing.isNew);
    close();
  };
  const remove = () => {
    if (!guidance || !deleting) return;
    const { kind, id: removeId } = deleting;
    if (kind === "statusModifiers") update({ ...guidance, oncology: { ...guidance.oncology, statusModifiers: guidance.oncology.statusModifiers.filter(row => row.id !== removeId) } });
    else if (kind === "radiotherapy") update({ ...guidance, oncology: { ...guidance.oncology, radiotherapy: guidance.oncology.radiotherapy.filter(row => row.id !== removeId) } });
    else if (kind === "plans") update({ ...guidance, products: { ...guidance.products, plans: guidance.products.plans.filter(row => row.id !== removeId) } });
    else if (kind === "comorbidities") update({ ...guidance, products: { ...guidance.products, comorbidities: guidance.products.comorbidities.filter(row => row.id !== removeId) } });
    else update({ ...guidance, products: { ...guidance.products, notes: guidance.products.notes.filter(row => row.id !== removeId) } });
    setDeleting(null);
  };
  if (!guidance) return <section className="rounded-2xl bg-card p-6 shadow-sm"><h2 className="text-lg font-medium">Care plan rules</h2><p className="mt-2 text-sm text-muted-foreground">This historical version has no care plan guidance.</p></section>;
  const counts = { statusModifiers: guidance.oncology.statusModifiers.length, radiotherapy: guidance.oncology.radiotherapy.length, plans: guidance.products.plans.length, comorbidities: guidance.products.comorbidities.length, notes: guidance.products.notes.length };
  const tabs: Array<[Section, string]> = [["mapping", "Risk mapping"], ["statusModifiers", "Drug-class by status"], ["radiotherapy", "Treatment guidance"], ["plans", "Products & doses"], ["comorbidities", "Co-morbidity diet"], ["notes", "Product exceptions"]];
  const title = tabs.find(([key]) => key === section)?.[1] ?? "";
  const summary = (row: Row) => {
    if ("riskEmphasis" in row) return `${lookup(classes, row.classId)} · ${statusLabels[row.nutritionalStatus]} · ${lookup(treatments, row.treatmentTypeId)}`;
    if ("stage" in row) return `${stageLabels[row.stage]} · ${statusLabels[row.nutritionalStatus]}`;
    if ("nutritionalStatus" in row) return `${lookup(treatments, row.treatmentTypeId ?? RADIOTHERAPY_TREATMENT_ID)} · ${statusLabels[row.nutritionalStatus]}`;
    if ("conditionId" in row) return lookup(conditions, row.conditionId);
    return row.label;
  };
  const detail = (row: Row) => {
    if ("riskEmphasis" in row) return row.riskEmphasis;
    if ("products" in row) {
      const selected = productPlanItems(row);
      if (!selected.length) return row.dose;
      // Names come from the shared Products list when available; quantities stay in this rule.
      const catalogItems = selected.map(item => ({ ...item,
        productName: catalog.find(product => product.name.toLocaleLowerCase() === item.productName.toLocaleLowerCase())?.name ?? item.productName }));
      return catalogItems.map(item => `${item.quantityPerDay === undefined ? "" : `${item.quantityPerDay} `}${item.productName}${item.unit ? ` (${item.unit})` : ""}`).join(" + ");
    }
    if ("kind" in row) {
      return `${exceptionPreview(row, surgeryOptions)}${row.guidance.trim() ? ` ${guidancePresentationText(row.guidance)}` : ""}`;
    }
    return guidancePresentationText(row.guidance);
  };
  return <section className="min-w-0 space-y-5 rounded-2xl bg-card p-4 shadow-sm sm:p-6" aria-label="Care plan rules">
    <div><h2 className="text-lg font-medium">Care plan rules</h2><p className="mt-1 text-sm text-muted-foreground">These saved rules determine which guidance is available to a report for this version.</p></div>
    <nav className="flex flex-wrap gap-2 border-b pb-3" aria-label="Care plan sections">{tabs.map(([key, label]) => <Button key={key} type="button" variant={section === key ? "default" : "outline"} onClick={() => { setSection(key); setQuery(""); }}>{label}{key !== "mapping" && <span className="ml-1 opacity-75">{counts[key]}</span>}</Button>)}</nav>
    {section === "mapping" ? <div className="space-y-5">
      <div><h3 className="font-medium">Map NIQ risk to nutritional status</h3><p className="mt-1 text-sm text-muted-foreground">The category names below come from Risk categories. Choose the nutritional status for each one. Renaming a category keeps this mapping.</p></div>
      <fieldset disabled={disabled} className="divide-y rounded-lg border">{definition.riskCategories.map(category => {
        const mapping = guidance.riskStatusMapping.find(item => item.riskCategoryId === category.id);
        return <div key={category.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center"><span className="font-medium">{category.label}</span><NativeSelect aria-label={`Nutritional status for ${category.label}`} value={mapping?.nutritionalStatus ?? ""} onChange={event => {
          const remaining = guidance.riskStatusMapping.filter(item => item.riskCategoryId !== category.id);
          update({ ...guidance, riskStatusMapping: event.target.value
            ? [...remaining, { riskCategoryId: category.id, nutritionalStatus: event.target.value as NutritionalStatus }]
            : remaining });
        }}><option value="">Select nutritional status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></div>;
      })}</fieldset>
      {guidance.riskStatusMapping.filter(item => !definition.riskCategories.some(category => category.id === item.riskCategoryId)).map(item => <div key={item.riskCategoryId} className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"><span>Mapping for removed risk category “{item.riskCategoryId}”</span><Button type="button" variant="outline" disabled={disabled} onClick={() => update({ ...guidance, riskStatusMapping: guidance.riskStatusMapping.filter(row => row.riskCategoryId !== item.riskCategoryId) })}>Remove mapping</Button></div>)}
      {definition.riskCategories.some(category => !guidance.riskStatusMapping.some(item => item.riskCategoryId === category.id)) && <p role="status" className="text-sm text-amber-700">Choose a nutritional status for every risk category before checking this rule version.</p>}
    </div> : <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{title}</h3><p className="text-sm text-muted-foreground">{section === "statusModifiers" ? "Class-level guidance matched with the mapped nutritional status." : section === "radiotherapy" ? "Nutrition guidance matched with the selected treatment and nutritional status." : section === "plans" ? "One plan per treatment stage and nutritional status." : section === "notes" ? "Conditional product exceptions applied only when the related patient fact is known." : "Editable guidance matched with confirmed assessment facts."}</p></div><Button type="button" disabled={disabled || rows.length >= (section === "statusModifiers" ? 200 : 100) || (section === "radiotherapy" && !treatments.length)} onClick={() => start(section)}><Plus className="size-4" aria-hidden="true" /> Add rule</Button></div>
      <label className="relative block"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" aria-label={`Search ${title}`} placeholder="Search rules…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="divide-y overflow-hidden rounded-lg border">{filtered.map(row => <div key={row.id} className="flex min-w-0 items-start justify-between gap-3 p-3 even:bg-muted/20"><div className="min-w-0"><p className="font-medium">{summary(row)}{!row.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">Disabled</span>}</p><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{detail(row)}</p></div><div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="icon" aria-label={`Edit ${summary(row)}`} disabled={disabled} onClick={() => start(section, row)}><Pencil className="size-4" /></Button><Button type="button" variant="ghost" size="icon" className="text-destructive" aria-label={`Delete ${summary(row)}`} disabled={disabled} onClick={() => setDeleting({ kind: section, id: row.id })}><Trash2 className="size-4" /></Button></div></div>)}{!filtered.length && <p className="p-5 text-sm text-muted-foreground">{rows.length ? "No rules match your search." : "No rules in this section."}</p>}</div>
    </div>}
    <p className="text-xs text-muted-foreground">Changes stay in this draft until you select Save draft below.</p>
    <Dialog open={editing !== null} onOpenChange={open => { if (!open) requestClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing?.isNew ? "Add" : "Edit"} {editing ? tabs.find(([key]) => key === editing.kind)?.[1].toLowerCase() : "rule"}</DialogTitle><DialogDescription>Configure the guidance used by this rule version.</DialogDescription></DialogHeader>{editing && <div className="space-y-4">
      {editing.kind === "statusModifiers" && <><div className="grid gap-3 sm:grid-cols-2"><Field label="Drug class"><NativeSelect value={editing.item.classId} onChange={event => patch({ classId: event.target.value })}>{classes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></Field><Field label="Treatment"><NativeSelect value={editing.item.treatmentTypeId} onChange={event => patch({ treatmentTypeId: event.target.value })}>{treatments.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></Field></div><Field label="Nutritional status">{statusOptions(editing.item.nutritionalStatus, value => patch({ nutritionalStatus: value }))}</Field><Field label="Risk emphasis"><Textarea rows={3} value={editing.item.riskEmphasis} onChange={event => patch({ riskEmphasis: event.target.value })} /></Field><Field label="Added actions"><Textarea rows={8} value={editing.item.actions} onChange={event => patch({ actions: event.target.value })} /></Field></>}
      {editing.kind === "radiotherapy" && <><Field label="Treatment type"><NativeSelect value={editing.item.treatmentTypeId ?? RADIOTHERAPY_TREATMENT_ID} onChange={event => patch({ treatmentTypeId: event.target.value })}>{treatments.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></Field><Field label="Nutritional status">{statusOptions(editing.item.nutritionalStatus, value => patch({ nutritionalStatus: value }))}</Field><Field label="Nutrition guidance"><Textarea rows={10} value={editing.item.guidance} onChange={event => patch({ guidance: event.target.value })} /></Field></>}
      {editing.kind === "plans" && <><div className="grid gap-3 sm:grid-cols-2"><Field label="Treatment stage"><NativeSelect value={editing.item.stage} onChange={event => { const stage = event.target.value as Products["plans"][number]["stage"]; patch({ stage, duration: editing.item.durationAmount ? productDurationText(stage, editing.item.durationAmount) : "" }); }}>{stages.map(item => <option key={item} value={item}>{stageLabels[item]}</option>)}</NativeSelect></Field><Field label="Nutritional status">{statusOptions(editing.item.nutritionalStatus, value => patch({ nutritionalStatus: value }))}</Field></div><ProductPlanCart key={editing.item.id} plan={editing.item} catalog={catalog} catalogError={catalogError} onRetry={() => setCatalogRetry(value => value + 1)} onChange={items => patch(items.length ? productPlanSnapshot(items) : { items: undefined, productNames: undefined, products: "", dose: "" })} /><Field label="Duration (days)"><Input type="number" min={1} max={3650} step={1} value={editing.item.durationAmount ?? ""} onChange={event => { const amount = event.target.value === "" ? undefined : Number(event.target.value); patch({ durationAmount: amount, duration: amount ? productDurationText(editing.item.stage, amount) : "" }); }} /></Field><p className="text-xs text-muted-foreground">{editing.item.stage === "pre_conditioning" ? "The report says supplements can start this many days before treatment. No treatment date is required." : editing.item.stage === "surgical" ? "Count from the recorded surgery date." : "This is the recommended duration; no extra date is needed."}</p></>}
      {editing.kind === "comorbidities" && <><Field label="Co-morbidity"><NativeSelect value={editing.item.conditionId} onChange={event => patch({ conditionId: event.target.value })}>{conditions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></Field><Field label="Name"><Input value={editing.item.label} onChange={event => patch({ label: event.target.value })} /></Field><Field label="Diet guidance"><Textarea rows={10} value={editing.item.guidance} onChange={event => patch({ guidance: event.target.value })} /></Field></>}
      {editing.kind === "notes" && <ProductExceptionEditor
        row={editing.item}
        catalog={catalog}
        catalogError={catalogError}
        onRetry={() => setCatalogRetry(value => value + 1)}
        surgeryOptions={surgeryOptions}
        others={guidance.products.notes}
        isNew={editing.isNew}
        onChange={item => setEditing({ ...editing, item })}
      />}

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={editing.item.enabled} onChange={event => patch({ enabled: event.target.checked })} />Enabled for this rule version</label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}<DialogFooter><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="button" onClick={save}>Save rule</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={confirmClose || deleting !== null} onOpenChange={open => { if (!open) { setConfirmClose(false); setDeleting(null); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleting ? "Delete this rule?" : "Discard unsaved edits?"}</AlertDialogTitle><AlertDialogDescription>{deleting ? "The rule will be removed from this draft. Save draft to keep the deletion." : "Changes in this editor will be lost."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => deleting ? remove() : close()}>{deleting ? "Delete rule" : "Discard edits"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
