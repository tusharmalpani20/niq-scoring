import { useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  TOXICITY_WORKBOOK_STATUSES,
  TOXICITY_WORKBOOK_STATUS_LABELS,
  toxicityWorkbookRiskDots,
  toxicityWorkbookSchema,
  type ToxicityWorkbook,
  type ToxicityWorkbookStatus,
} from "@niq-scoring/contracts/toxicity-workbook";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

type Rule = ToxicityWorkbook["rules"][number];
type Variant = Rule["variants"][ToxicityWorkbookStatus];
type Props = {
  workbook: ToxicityWorkbook;
  disabled: boolean;
  onChange: (workbook: ToxicityWorkbook) => void;
  onReferenceSelect: (id: string) => void;
  treatments: readonly { id: Rule["treatmentTypeId"]; label: string }[];
  drugClasses: readonly { id: string; label: string }[];
};

const chemotherapy = "current_cancer_treatment_chemotherapy";
const allChemotherapyClassId = "__all_chemotherapy_classes__";
const allChemotherapyClassLabel = "All cytotoxic chemotherapy";
const guidanceFields = [
  ["intervention", "Nutrition prophylaxis & management"],
  ["escalation", "Escalate when"],
  ["actionOwner", "Action owner"],
  ["rationale", "Why it matters"],
] as const;
const riskFactors = [
  { key: "frequencyPoints", label: "Frequency points", options: ["Less frequent", "Moderately frequent", "More frequent"] },
  { key: "intakeImpactPoints", label: "Intake impact points", options: ["Smaller impact", "Moderate impact", "Greater impact"] },
] as const;

function missingGuidance(variant: Variant) {
  return guidanceFields.find(([key]) => !variant[key].trim());
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-sm">
    <span className="block font-medium">{label}</span>{children}
  </label>;
}

function NutritionRisk({ dots }: { dots: 1 | 2 | 3 | null }) {
  if (dots === null) return <span className="text-muted-foreground">Not rated</span>;
  return <span className="inline-flex flex-wrap items-center gap-x-2 text-primary">
    <span className="sr-only">{dots} out of 3 nutrition risk dots</span>
    <span aria-hidden="true">{"●".repeat(dots)}{"○".repeat(3 - dots)}</span>
    <span aria-hidden="true" className="whitespace-nowrap text-xs text-muted-foreground">{dots} of 3</span>
  </span>;
}

export function ToxicityWorkbookPanel({ workbook, disabled, onChange, onReferenceSelect, treatments, drugClasses }: Props) {
  const [status, setStatus] = useState<ToxicityWorkbookStatus>("well_nourished");
  const [query, setQuery] = useState("");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [dialogStatus, setDialogStatus] = useState<ToxicityWorkbookStatus>("well_nourished");
  const [editor, setEditor] = useState<{ original: Rule; draft: Rule } | null>(null);
  const [step, setStep] = useState<"basics" | "guidance">("basics");
  const [referenceQuery, setReferenceQuery] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"delete" | "discard" | null>(null);
  const dialogBody = useRef<HTMLDivElement>(null);

  const selected = workbook.rules.find(rule => rule.row === selectedRow);
  const detail = editor?.draft ?? selected;
  const variant = detail?.variants[dialogStatus];
  const frequencyBasis = variant?.frequencyBasis ?? detail?.frequencyBasis ?? "";
  const risk = detail?.risk;
  const completedStatuses = editor ? TOXICITY_WORKBOOK_STATUSES.filter(value => !missingGuidance(editor.draft.variants[value])).length : 0;
  const nextStatus = !selected && completedStatuses < TOXICITY_WORKBOOK_STATUSES.length
    ? TOXICITY_WORKBOOK_STATUSES[TOXICITY_WORKBOOK_STATUSES.indexOf(dialogStatus) + 1] : undefined;
  const treatmentName = (id: Rule["treatmentTypeId"]) => treatments.find(treatment => treatment.id === id)?.label ?? id;
  const search = query.trim().toLocaleLowerCase();
  const rules = workbook.rules.filter(rule => !search || [rule.classLabel, rule.effect, treatmentName(rule.treatmentTypeId)]
    .some(value => value.toLocaleLowerCase().includes(search)));
  const referenceSearch = referenceQuery.trim().toLocaleLowerCase();
  const availableReferences = workbook.references.filter(reference => !referenceSearch
    || `${reference.id} ${reference.text}`.toLocaleLowerCase().includes(referenceSearch));

  function beginEditing(rule: Rule, initialStep: typeof step) {
    setEditor({ original: rule, draft: rule });
    setStep(initialStep);
    setError("");
    setReferenceQuery("");
  }

  function addRule() {
    const emptyVariant: Variant = { intervention: "", escalation: "", actionOwner: "", rationale: "", frequencyBasis: "", referenceIds: [] };
    setDialogStatus("well_nourished");
    beginEditing({
      row: Math.max(0, ...workbook.rules.map(rule => rule.row)) + 1,
      classId: "",
      classLabel: "",
      treatmentTypeId: treatments[0]?.id ?? chemotherapy,
      effect: "",
      risk: null,
      variants: { well_nourished: emptyVariant, moderately_nourished: emptyVariant, severely_malnourished: emptyVariant },
    }, "basics");
  }

  function changeStatus(value: ToxicityWorkbookStatus) {
    setDialogStatus(value);
    setReferenceQuery("");
    setError("");
    dialogBody.current?.scrollTo({ top: 0 });
  }

  function changeStep(value: typeof step) {
    setStep(value);
    setError("");
  }

  function closeDialog() {
    setSelectedRow(null);
    setEditor(null);
    setError("");
    setConfirm(null);
  }

  function requestClose() {
    if (editor && JSON.stringify(editor.draft) !== JSON.stringify(editor.original)) {
      setConfirm("discard");
      return;
    }
    closeDialog();
  }

  function updateRule(patch: Partial<Rule>) {
    setEditor(current => current ? { ...current, draft: { ...current.draft, ...patch } } : null);
  }

  function updateVariant(patch: Partial<Variant>) {
    if (!detail || !variant) return;
    updateRule({ variants: { ...detail.variants, [dialogStatus]: { ...variant, ...patch } } });
  }

  function checkBasics(rule: Rule) {
    if (!rule.effect.trim() || !rule.classLabel) {
      setStep("basics");
      setError("Enter an effect and choose a drug class.");
      return false;
    }
    return true;
  }

  function checkGuidance(rule: Rule, value: ToxicityWorkbookStatus) {
    const missing = missingGuidance(rule.variants[value]);
    if (missing) {
      changeStatus(value);
      setError(`Enter ${missing[1]} for ${TOXICITY_WORKBOOK_STATUS_LABELS[value]}.`);
      return false;
    }
    return true;
  }

  function applyChanges() {
    if (!editor || disabled) return;
    const rule = editor.draft;
    if (!checkBasics(rule) || !TOXICITY_WORKBOOK_STATUSES.every(value => checkGuidance(rule, value))) return;
    const next = { ...workbook, rules: selected ? workbook.rules.map(item => item.row === rule.row ? rule : item) : [...workbook.rules, rule] };
    const parsed = toxicityWorkbookSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the rule before applying changes.");
      return;
    }
    onChange(parsed.data);
    closeDialog();
  }

  function confirmAction() {
    if (confirm === "delete" && selected && !disabled) {
      onChange({ ...workbook, rules: workbook.rules.filter(rule => rule.row !== selected.row) });
    }
    closeDialog();
  }

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="font-medium">Drug-class guidance</h3>
        <p className="text-sm text-muted-foreground">{workbook.rules.length} rules · {workbook.rules.length * TOXICITY_WORKBOOK_STATUSES.length} nutrition-status entries</p>
      </div>
      {!disabled && <Button type="button" disabled={workbook.rules.length >= 500} onClick={addRule}><Plus aria-hidden="true" /> Add rule</Button>}
    </div>
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
      <Input aria-label="Search drug-class rules" placeholder="Search by drug class, effect, or treatment…" value={query} onChange={event => setQuery(event.target.value)} />
      <NativeSelect aria-label="Nutrition status" value={status} onChange={event => setStatus(event.target.value as ToxicityWorkbookStatus)}>
        {TOXICITY_WORKBOOK_STATUSES.map(value => <option key={value} value={value}>{TOXICITY_WORKBOOK_STATUS_LABELS[value]}</option>)}
      </NativeSelect>
    </div>
    <div className="min-w-0 overflow-hidden rounded-lg border">
      <Table className="min-w-[34rem] table-fixed">
        <TableHeader><TableRow className="bg-primary/5">
          <TableHead className="w-[31%]">Drug class / treatment</TableHead>
          <TableHead className="w-[44%]">Effect</TableHead>
          <TableHead className="w-[17%]">Nutrition risk</TableHead>
          <TableHead className="w-[8%]"><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{rules.map(rule => <TableRow key={rule.row} className="even:bg-muted/20">
          <TableCell className="whitespace-normal">
            <span className="font-medium">{rule.classLabel}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{treatmentName(rule.treatmentTypeId)}</span>
          </TableCell>
          <TableCell className="whitespace-normal">{rule.effect}</TableCell>
          <TableCell><NutritionRisk dots={toxicityWorkbookRiskDots(workbook.riskMatrix, rule.risk, status)} /></TableCell>
          <TableCell className="text-right">
            <Button type="button" variant="ghost" size="sm" aria-label={`View ${rule.effect} for ${rule.classLabel}`} onClick={() => {
              setSelectedRow(rule.row);
              setDialogStatus(status);
            }}>View</Button>
          </TableCell>
        </TableRow>)}</TableBody>
      </Table>
      {!rules.length && <p className="p-4 text-sm text-muted-foreground">{workbook.rules.length ? "No rules match this search." : "No drug-class rules in this version."}</p>}
    </div>

    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent className="max-h-[92dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-4 sm:max-w-2xl sm:p-6">
        {detail && variant && <>
          <DialogHeader className="pr-5">
            <DialogTitle>{editor ? selected ? "Edit drug-class rule" : "Add drug-class rule" : detail.effect}</DialogTitle>
            <DialogDescription>{editor ? (step === "basics" ? "Step 1 of 2 · Basic details" : "Step 2 of 2 · Nutrition guidance") : `${detail.classLabel} · ${treatmentName(detail.treatmentTypeId)}`}</DialogDescription>
          </DialogHeader>
          <div key={editor ? step : "view"} ref={dialogBody} className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-2">
            {editor && step === "basics" ? <div className="space-y-3">
              <Field label="Effect"><Input value={detail.effect} onChange={event => updateRule({ effect: event.target.value })} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Treatment"><NativeSelect aria-label="Treatment" value={detail.treatmentTypeId} onChange={event => {
                  const treatmentTypeId = event.target.value as Rule["treatmentTypeId"];
                  updateRule(detail.classId === null && treatmentTypeId !== chemotherapy
                    ? { treatmentTypeId, classId: "", classLabel: "" }
                    : { treatmentTypeId });
                }}>{treatments.map(treatment => <option key={treatment.id} value={treatment.id}>{treatment.label}</option>)}</NativeSelect></Field>
                <Field label="Drug class"><NativeSelect aria-label="Drug class" value={detail.classId ?? allChemotherapyClassId} onChange={event => {
                  const classId = event.target.value;
                  updateRule(classId === allChemotherapyClassId
                    ? { classId: null, classLabel: allChemotherapyClassLabel }
                    : { classId, classLabel: drugClasses.find(item => item.id === classId)?.label ?? "" });
                }}>
                  <option value="">Select drug class</option>
                  {detail.treatmentTypeId === chemotherapy && <option value={allChemotherapyClassId}>{allChemotherapyClassLabel}</option>}
                  {drugClasses.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </NativeSelect></Field>
              </div>
              <fieldset className="space-y-2 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">Nutrition risk</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={detail.risk !== null} className="size-4 accent-primary" onChange={event => updateRule({
                    risk: event.target.checked ? { frequencyPoints: 1, intakeImpactPoints: 1 } : null,
                  })} />
                  Add a nutrition risk rating
                </label>
                {risk && <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Choose how often the effect occurs and how much it affects eating. The dots are calculated for each nutrition status.</p>
                  <div className="grid gap-3 sm:grid-cols-2">{riskFactors.map(({ key, label, options }) => (
                    <Field key={key} label={label}><NativeSelect aria-label={label} value={risk[key]} onChange={event => {
                      updateRule({ risk: { ...risk, [key]: Number(event.target.value) } });
                    }}>
                      {options.map((description, index) => <option key={description} value={index + 1}>{index + 1} · {description}</option>)}
                    </NativeSelect></Field>
                  ))}</div>
                  <dl className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-3" aria-label="Nutrition risk preview">
                    {TOXICITY_WORKBOOK_STATUSES.map(value => <div key={value}>
                      <dt className="text-muted-foreground">{TOXICITY_WORKBOOK_STATUS_LABELS[value]}</dt>
                      <dd><NutritionRisk dots={toxicityWorkbookRiskDots(workbook.riskMatrix, risk, value)} /></dd>
                    </div>)}
                  </dl>
                </div>}
              </fieldset>
            </div> : <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-1.5" aria-label="Nutrition status guidance">
                {TOXICITY_WORKBOOK_STATUSES.map(value => <Button
                  type="button" key={value} size="sm" variant={value === dialogStatus ? "default" : "outline"} aria-pressed={value === dialogStatus}
                  onClick={() => changeStatus(value)}
                >{TOXICITY_WORKBOOK_STATUS_LABELS[value]}</Button>)}
              </div>
              {editor && !selected && <p className="text-xs text-muted-foreground">{completedStatuses} of {TOXICITY_WORKBOOK_STATUSES.length} statuses complete</p>}
              <p><span className="mr-2 font-medium">Nutrition risk</span><NutritionRisk dots={toxicityWorkbookRiskDots(workbook.riskMatrix, detail.risk, dialogStatus)} /></p>
              {editor ? <Field label="Frequency basis"><Textarea value={frequencyBasis} maxLength={12000} onChange={event => updateVariant({ frequencyBasis: event.target.value })} /></Field> : frequencyBasis && <div>
                <h4 className="mb-1 font-medium">Frequency basis</h4>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">{frequencyBasis}</p>
              </div>}
              {guidanceFields.map(([key, label]) => editor ? <Field key={key} label={label}>
                <Textarea value={variant[key]} onChange={event => updateVariant({ [key]: event.target.value })} />
              </Field> : <div key={key}>
                <h4 className="mb-1 font-medium">{label}</h4>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">{variant[key]}</p>
              </div>)}
              {editor ? <details className="space-y-2 rounded-lg border p-3">
                <summary className="cursor-pointer font-medium">Linked references <span className="ml-1 font-normal text-muted-foreground">({variant.referenceIds.length} selected)</span></summary>
                {workbook.references.length ? <>
                  <Input aria-label="Find references to link" placeholder="Search by reference number or text…" value={referenceQuery} onChange={event => setReferenceQuery(event.target.value)} />
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {availableReferences.map(reference => <label key={reference.id} className="flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/40">
                      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" aria-label={`Link reference ${reference.id}`} checked={variant.referenceIds.includes(reference.id)}
                        onChange={event => updateVariant({ referenceIds: event.target.checked
                          ? [...variant.referenceIds, reference.id]
                          : variant.referenceIds.filter(id => id !== reference.id) })} />
                      <span className="min-w-0 break-words"><span className="mr-1 font-medium">{reference.id}</span>{reference.text}</span>
                    </label>)}
                    {!availableReferences.length && <p className="text-muted-foreground">No references match this search.</p>}
                  </div>
                </> : <p className="text-muted-foreground">Add references in the References tab to link them here.</p>}
              </details> : <div>
                <h4 className="mb-1.5 font-medium">References</h4>
                {variant.referenceIds.length ? <div className="flex flex-wrap gap-1.5">
                  {variant.referenceIds.map(id => <Button type="button" key={id} variant="outline" size="xs" aria-label={`View reference ${id}`} onClick={() => {
                    closeDialog();
                    onReferenceSelect(id);
                  }}>{id}</Button>)}
                </div> : <p className="text-muted-foreground">No linked references.</p>}
              </div>}
            </div>}
          </div>
          <div className="space-y-2">
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="flex-row flex-wrap justify-end">
              {!disabled && !editor && <Button type="button" variant="ghost" className="text-destructive sm:mr-auto" onClick={() => setConfirm("delete")}>Delete rule</Button>}
              {!disabled && editor && step === "guidance" && <Button type="button" variant="outline" className="mr-auto" onClick={() => changeStep("basics")}>Back</Button>}
              <Button type="button" variant="outline" onClick={requestClose}>{editor ? "Cancel" : "Close"}</Button>
              {!disabled && editor && step === "basics" && <Button type="button" onClick={() => {
                if (checkBasics(editor.draft)) changeStep("guidance");
              }}>Next: Guidance</Button>}
              {!disabled && editor && step === "guidance" && (nextStatus ? <Button type="button" onClick={() => {
                  if (checkGuidance(editor.draft, dialogStatus)) changeStatus(nextStatus);
                }}>Next status</Button> : <Button type="button" onClick={applyChanges}>{selected ? "Apply changes" : "Add rule"}</Button>)}
              {!disabled && !editor && <Button type="button" onClick={() => beginEditing(detail, "guidance")}>Edit rule</Button>}
            </DialogFooter>
          </div>
        </>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm === "delete" ? "Delete this rule?" : "Discard rule changes?"}</AlertDialogTitle>
          <AlertDialogDescription>{confirm === "delete" ? "Save the draft to keep this removal." : "Your changes have not been applied to the draft."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{confirm === "delete" ? "Cancel" : "Keep editing"}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirmAction}>{confirm === "delete" ? "Delete rule" : "Discard changes"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
