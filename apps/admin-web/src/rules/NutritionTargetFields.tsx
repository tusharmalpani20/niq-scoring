import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import {
  DIALYSIS_STATUS_OPTIONS,
  editableNutritionTargetExceptionsSchema,
  kidneyProteinRules,
  nutritionTargetRangesSchema,
  type FinalAssessmentDefinition,
} from "@niq-scoring/contracts/final-assessment";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

type Guidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;
type Targets = NonNullable<Guidance["nutrition"][number]["targets"]>;
type Exceptions = NonNullable<Guidance["nutritionTargetExceptions"]>;
type RangeInputs = { min: string; max: string };
type KidneyProteinRule = ReturnType<typeof kidneyProteinRules>[number];
type DialysisStatusId = KidneyProteinRule["dialysisStatusId"];
type KidneyRuleInputs = {
  dialysisStatusId: DialysisStatusId;
  enabled: boolean;
  stages: RangeInputs;
  protein: RangeInputs;
};
export type TargetInputs = Record<keyof Targets, RangeInputs>;

const metrics = [
  { id: "energy", label: "Energy", unit: "kcal/kg/day" },
  { id: "protein", label: "Protein", unit: "g/kg/day" },
  { id: "fluids", label: "Fluids", unit: "mL/kg/day" },
] as const;
const kidneyRuleColumns = "items-center gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.85fr)] sm:gap-3";

const rangeInputs = (range?: Targets["energy"]): RangeInputs => ({
  min: range ? String(range.min) : "",
  max: range ? String(range.max) : "",
});
const readNumber = (input: string) => input.trim() ? Number(input) : NaN;
const readRange = (range: RangeInputs) => ({ min: readNumber(range.min), max: readNumber(range.max) });
const rangeText = (range: Targets["energy"]) => `${range.min}–${range.max}`;
const proteinRangeText = (range: Targets["protein"]) => [range.min, range.max]
  .map(value => Number.isInteger(value) ? value.toFixed(1) : String(value)).join("–");

function kidneyRuleInputs(dialysisStatusId: DialysisStatusId, rule?: KidneyProteinRule): KidneyRuleInputs {
  const stages = rule?.dialysisStatusId === "not_on_dialysis" ? rule.ckdStages : undefined;
  return {
    dialysisStatusId,
    enabled: rule !== undefined,
    stages: stages ? { min: String(stages.minStage), max: String(stages.maxStage) } : rangeInputs(),
    protein: rangeInputs(rule?.protein),
  };
}

function kidneyRuleText(rule: KidneyProteinRule) {
  const range = proteinRangeText(rule.protein);
  if (rule.dialysisStatusId === "not_on_dialysis") {
    return `Non-dialysis CKD (Stage ${rule.ckdStages.minStage}–${rule.ckdStages.maxStage}): ${range} g/kg/d protein`;
  }
  const label = rule.dialysisStatusId === "haemodialysis" ? "Hemodialysis" : "Peritoneal dialysis";
  return `${label}: ${range} g/kg/d`;
}

export const targetInputs = (targets?: Targets): TargetInputs => ({
  energy: rangeInputs(targets?.energy),
  protein: rangeInputs(targets?.protein),
  fluids: rangeInputs(targets?.fluids),
});

export function parseTargetInputs(fields: TargetInputs) {
  return nutritionTargetRangesSchema.safeParse({
    energy: readRange(fields.energy),
    protein: readRange(fields.protein),
    fluids: readRange(fields.fluids),
  });
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-sm">
    <span className="font-medium">{label}</span>
    {children}
  </label>;
}

function RangeFields({ label, unit, range, onChange }: {
  label: string;
  unit: string;
  range: RangeInputs;
  onChange: (range: RangeInputs) => void;
}) {
  return <fieldset className="min-w-0 space-y-2">
    <legend className="text-sm font-medium">{label} <span className="font-normal text-muted-foreground">({unit})</span></legend>
    <div className="grid grid-cols-2 gap-2">
      <Field label="Minimum">
        <Input type="number" step="any" aria-label={`${label} minimum`} value={range.min}
          onChange={event => onChange({ ...range, min: event.target.value })} />
      </Field>
      <Field label="Maximum">
        <Input type="number" step="any" aria-label={`${label} maximum`} value={range.max}
          onChange={event => onChange({ ...range, max: event.target.value })} />
      </Field>
    </div>
  </fieldset>;
}

function InlineRange({ label, range, stage, onChange }: {
  label: string;
  range: RangeInputs;
  stage?: boolean;
  onChange: (range: RangeInputs) => void;
}) {
  const bounds = stage ? { min: 1, max: 5, step: 1 } : { step: "any" };
  return <fieldset className="min-w-0 space-y-1.5">
    <legend className="text-sm font-medium sm:sr-only">{label}</legend>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <Input type="number" {...bounds} aria-label={`${label} from`} placeholder="From" value={range.min}
        onChange={event => onChange({ ...range, min: event.target.value })} />
      <span className="text-sm text-muted-foreground" aria-hidden="true">to</span>
      <Input type="number" {...bounds} aria-label={`${label} to`} placeholder="To" value={range.max}
        onChange={event => onChange({ ...range, max: event.target.value })} />
    </div>
  </fieldset>;
}

export function NutritionTargetFields({ fields, onChange }: {
  fields: TargetInputs;
  onChange: (fields: TargetInputs) => void;
}) {
  return <section aria-label="Daily targets" className="space-y-3 rounded-lg border p-3">
    <div>
      <h3 className="text-sm font-semibold">Daily targets</h3>
      <p className="text-xs text-muted-foreground">Enter ranges per kilogram of body weight.</p>
    </div>
    <div className="space-y-3">
      {metrics.map(({ id, label, unit }) => (
        <RangeFields key={id} label={label} unit={unit} range={fields[id]}
          onChange={range => onChange({ ...fields, [id]: range })} />
      ))}
    </div>
  </section>;
}

export function NutritionTargetSummary({ targets }: { targets: Targets }) {
  return <dl className="space-y-1 text-xs">
    {metrics.map(({ id, label, unit }) => (
      <div key={id} className="flex flex-wrap gap-x-1">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="font-medium tabular-nums">{rangeText(targets[id])} {unit}</dd>
      </div>
    ))}
  </dl>;
}

function exceptionInputs(value?: Exceptions) {
  const savedRules = value ? kidneyProteinRules(value) : [];
  return {
    minimumBmi: value ? String(value.adjustedWeight.minimumBmi) : "",
    idealWeightBmi: value ? String(value.adjustedWeight.idealWeightBmi) : "",
    weightDifferenceFactor: value ? String(value.adjustedWeight.weightDifferenceFactor) : "",
    kidneyProteinRules: DIALYSIS_STATUS_OPTIONS.map(({ id }) =>
      kidneyRuleInputs(id, savedRules.find(rule => rule.dialysisStatusId === id))),
    kidneyFluidNote: value?.kidneyFluidNote ?? "",
    fluidRestrictionNote: value?.fluidRestrictionNote ?? "",
  };
}

export function NutritionTargetExceptionsEditor({ value, disabled, onChange }: {
  value: Exceptions | undefined;
  disabled: boolean;
  onChange: (value: Exceptions) => void;
}) {
  const [draft, setDraft] = useState<ReturnType<typeof exceptionInputs> | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState("");

  const close = () => { setConfirmDiscard(false); setDraft(null); };
  const requestClose = () => {
    if (draft && JSON.stringify(draft) !== JSON.stringify(exceptionInputs(value))) {
      setConfirmDiscard(true);
      return;
    }
    close();
  };

  const save = () => {
    if (!draft || disabled) return;
    const rules = draft.kidneyProteinRules.filter(rule => rule.enabled);
    const parsed = editableNutritionTargetExceptionsSchema.safeParse({
      adjustedWeight: {
        minimumBmi: readNumber(draft.minimumBmi),
        idealWeightBmi: readNumber(draft.idealWeightBmi),
        weightDifferenceFactor: readNumber(draft.weightDifferenceFactor),
      },
      kidneyProteinRules: rules.map(rule => ({
        dialysisStatusId: rule.dialysisStatusId,
        protein: readRange(rule.protein),
        ...(rule.dialysisStatusId === "not_on_dialysis" ? {
          ckdStages: { minStage: readNumber(rule.stages.min), maxStage: readNumber(rule.stages.max) },
        } : {}),
      })),
      kidneyFluidNote: draft.kidneyFluidNote,
      fluidRestrictionNote: draft.fluidRestrictionNote,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.path[0] === "kidneyProteinRules") {
        const rule = typeof issue.path[1] === "number" ? rules[issue.path[1]] : undefined;
        const label = DIALYSIS_STATUS_OPTIONS.find(option => option.id === rule?.dialysisStatusId)?.label;
        setError(label ? `Check the ranges for ${label}.` : issue.message);
      } else if (issue?.path[0] === "adjustedWeight" && issue.code === "custom") {
        setError(issue.message);
      } else {
        setError("Enter positive BMI values, a weight difference factor between 0 and 1, and both fluid notes.");
      }
      return;
    }
    onChange(parsed.data);
    close();
  };
  const updateKidneyRule = (next: KidneyRuleInputs) => {
    setDraft(current => current && {
      ...current,
      kidneyProteinRules: current.kidneyProteinRules.map(rule => rule.dialysisStatusId === next.dialysisStatusId ? next : rule),
    });
  };
  const savedKidneyRules = value ? kidneyProteinRules(value) : [];
  // List the supplied non-dialysis guidance first, as in the source wording.
  const kidneySummary = [
    ...savedKidneyRules.filter(rule => rule.dialysisStatusId === "not_on_dialysis"),
    ...savedKidneyRules.filter(rule => rule.dialysisStatusId !== "not_on_dialysis"),
  ].map(kidneyRuleText).join("; ");

  return <section aria-label="Calculation exceptions" className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-medium">Calculation exceptions</h3>
      <Button type="button" variant="outline" size="sm" disabled={disabled}
        onClick={() => {
          setError("");
          setDraft(exceptionInputs(value));
        }}>
        <Pencil className="size-4" aria-hidden="true" /> {value ? "Edit exceptions" : "Set exceptions"}
      </Button>
    </div>
    {value ? <dl className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
      <div>
        <dt className="font-medium">Obesity (BMI ≥ {value.adjustedWeight.minimumBmi} kg/m²):</dt>
        <dd className="text-muted-foreground">
          Calculate Ideal Body Weight (IBW) at BMI {value.adjustedWeight.idealWeightBmi}, then use Adjusted Body Weight: AdjBW = IBW + {value.adjustedWeight.weightDifferenceFactor} × (Actual Weight − IBW).
        </dd>
      </div>
      {kidneySummary && <div>
        <dt className="font-medium">Kidney protein</dt>
        <dd className="text-muted-foreground">{kidneySummary}</dd>
      </div>}
      <div>
        <dt className="font-medium">Kidney fluids</dt>
        <dd className="text-muted-foreground">{value.kidneyFluidNote}</dd>
      </div>
      <div>
        <dt className="font-medium">Fluid restriction</dt>
        <dd className="text-muted-foreground">{value.fluidRestrictionNote}</dd>
      </div>
    </dl> : <p className="text-sm text-muted-foreground">No calculation exceptions set.</p>}
    <Dialog open={draft !== null} onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit calculation exceptions</DialogTitle>
          <DialogDescription>Set the exceptions shared by the nutrition risk categories.</DialogDescription>
        </DialogHeader>
        {draft && <fieldset disabled={disabled} className="min-w-0 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Adjusted weight</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Minimum BMI">
                <Input type="number" step="any" value={draft.minimumBmi}
                  onChange={event => setDraft({ ...draft, minimumBmi: event.target.value })} />
              </Field>
              <Field label="Ideal-weight BMI">
                <Input type="number" step="any" value={draft.idealWeightBmi}
                  onChange={event => setDraft({ ...draft, idealWeightBmi: event.target.value })} />
              </Field>
              <Field label="Weight difference factor">
                <Input type="number" step="any" value={draft.weightDifferenceFactor}
                  onChange={event => setDraft({ ...draft, weightDifferenceFactor: event.target.value })} />
              </Field>
            </div>
          </fieldset>
          <section className="space-y-2 rounded-lg border p-3" aria-label="Kidney protein">
            <h3 className="text-sm font-semibold">Kidney protein</h3>
            <p className="text-xs text-muted-foreground">Use the nutrition category’s protein range unless a kidney exception matches.</p>
            <div className={`${kidneyRuleColumns} hidden text-xs text-muted-foreground sm:grid`} aria-hidden="true">
              <span>Dialysis status</span>
              <span>Protein range (g/kg/day)</span>
              <span>Recorded CKD stages</span>
            </div>
            {draft.kidneyProteinRules.map(rule => {
              const label = DIALYSIS_STATUS_OPTIONS.find(option => option.id === rule.dialysisStatusId)!.label;
              return <div key={rule.dialysisStatusId} role="group" aria-label={label}
                className={`grid border-t py-2 ${kidneyRuleColumns}`}>
                <label className="flex min-h-9 min-w-0 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={rule.enabled}
                    onChange={event => updateKidneyRule({ ...rule, enabled: event.target.checked })} />
                  <span>{label}</span>
                </label>
                {rule.enabled ? <InlineRange label="Protein range (g/kg/day)" range={rule.protein}
                  onChange={protein => updateKidneyRule({ ...rule, protein })} />
                  : <span className="text-xs text-muted-foreground">Standard protein range</span>}
                {rule.enabled && rule.dialysisStatusId === "not_on_dialysis" &&
                  <InlineRange label="Recorded CKD stages" stage range={rule.stages}
                    onChange={stages => updateKidneyRule({ ...rule, stages })} />}
              </div>;
            })}
          </section>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kidney fluid note">
              <Textarea rows={1} className="min-h-12" maxLength={1000} value={draft.kidneyFluidNote}
                onChange={event => setDraft({ ...draft, kidneyFluidNote: event.target.value })} />
            </Field>
            <Field label="Fluid restriction note">
              <Textarea rows={1} className="min-h-12" maxLength={1000} value={draft.fluidRestrictionNote}
                onChange={event => setDraft({ ...draft, fluidRestrictionNote: event.target.value })} />
            </Field>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </fieldset>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
          <Button type="button" disabled={disabled} onClick={save}>Apply exceptions</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard exception edits?</AlertDialogTitle>
          <AlertDialogDescription>These edits have not been applied to the draft.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={close}>Discard edits</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
