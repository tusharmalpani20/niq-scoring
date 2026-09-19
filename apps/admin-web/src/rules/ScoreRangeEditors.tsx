import type { Dispatch, SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { faceScanRangeConfigSchema, DEFAULT_FACE_SCAN_SCORING_CONFIG, normalizeFaceScanScoringConfig, type FaceScanRangeConfig } from "@niq-scoring/contracts/face-scan-scoring";
import { validateFinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment-validation";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { newRuleId } from "./questionnaire-model";

type DraftProps = { drafts: Record<string, string>; setDrafts: Dispatch<SetStateAction<Record<string, string>>> };
type EditorProps = DraftProps & { definition: FinalAssessmentDefinition; disabled: boolean; onChange: (definition: FinalAssessmentDefinition) => void };

function NumberCell({ label, draftKey, value, onChange, drafts, setDrafts, percent = false, hideLabel = false }: DraftProps & { label: string; draftKey: string; value: number; percent?: boolean; hideLabel?: boolean; onChange: (value: number) => void }) {
  const raw = drafts[draftKey];
  const invalid = raw !== undefined && (raw.trim() === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0 || (percent ? Number(raw) > 100 : !Number.isSafeInteger(Number(raw))));
  return <label className="block min-w-0 space-y-1 text-sm"><span className={hideLabel ? "sr-only" : "text-xs text-muted-foreground"}>{label}</span><Input type="number" className="h-9 shadow-none" aria-label={label} min={0} max={percent ? 100 : undefined} step={percent ? "any" : 1} value={raw ?? value} aria-invalid={invalid} onChange={event => {
    const text = event.target.value;
    setDrafts(current => ({ ...current, [draftKey]: text }));
    const number = Number(text);
    if (text.trim() !== "" && Number.isFinite(number) && number >= 0 && (percent ? number <= 100 : Number.isSafeInteger(number))) onChange(number);
  }} />{invalid && <span role="alert" className="text-xs text-destructive">{percent ? "Enter a number from 0 to 100." : "Enter a whole number of 0 or more."}</span>}</label>;
}

function RangeErrors({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return <ul role="alert" aria-label="Range errors" className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{[...new Set(messages)].map(message => <li key={message}>{message}</li>)}</ul>;
}

export function SimpleRiskEditor({ definition, disabled, onChange, drafts, setDrafts }: EditorProps) {
  const patch = (id: string, change: Partial<FinalAssessmentDefinition["riskCategories"][number]>) => onChange({ ...definition, riskCategories: definition.riskCategories.map(category => category.id === id ? { ...category, ...change } : category) });
  const messages = validateFinalAssessmentDefinition(definition).filter(issue => issue.path.startsWith("riskCategories")).map(issue => issue.message);
  if (definition.riskCategories.some(category => !category.label.trim())) messages.push("Enter a name for every category.");
  const clearDraft = (prefix: string) => setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix))));
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Risk categories</h2><p className="mt-1 text-sm text-muted-foreground">Match the total assessment score to a category.</p></div><Button type="button" variant="outline" size="icon" aria-label="Add category" title="Add category" onClick={() => onChange({ ...definition, riskCategories: [...definition.riskCategories, { id: newRuleId("category"), label: "New category", interpretation: "", min: 0, max: null, minInclusive: true, maxInclusive: true, sources: [] }] })}><Plus className="size-4" aria-hidden="true" /></Button></div>
    <div className="divide-y rounded-lg border">{definition.riskCategories.map(category => {
      // Present equivalent inclusive integer endpoints without rewriting historical definitions on render.
      const from = category.min === null ? 0 : Math.max(0, category.minInclusive ? Math.ceil(category.min) : Math.floor(category.min) + 1);
      const to = category.max === null ? null : category.maxInclusive ? Math.floor(category.max) : Math.ceil(category.max) - 1;
      return <div key={category.id} className="space-y-2 p-3"><div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-start gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_2rem]"><label className="col-span-2 min-w-0 space-y-1 text-sm md:col-span-1"><span className="text-xs text-muted-foreground">Category name</span><Input className="h-9 shadow-none" value={category.label} onChange={event => patch(category.id, { label: event.target.value })} /></label><div className="col-start-1 md:col-start-auto"><NumberCell label="From score" draftKey={`risk:${category.id}:from`} value={from} drafts={drafts} setDrafts={setDrafts} onChange={min => patch(category.id, { min, minInclusive: true })} /></div><div className="min-w-0 space-y-2">{to !== null ? <NumberCell label="To score" draftKey={`risk:${category.id}:to`} value={to} drafts={drafts} setDrafts={setDrafts} onChange={max => patch(category.id, { max, maxInclusive: true })} /> : <div className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">To score</span><div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-muted-foreground">No limit</div></div>}<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={to === null} onChange={event => { clearDraft(`risk:${category.id}:to`); patch(category.id, { max: event.target.checked ? null : from, maxInclusive: true }); }} />No upper limit</label></div><Button type="button" variant="ghost" size="icon" className="col-start-3 row-start-1 size-8 text-destructive md:col-start-4 md:mt-5" aria-label={`Remove ${category.label}`} title={`Remove ${category.label}`} disabled={definition.riskCategories.length <= 1} onClick={() => { clearDraft(`risk:${category.id}:`); onChange({ ...definition, riskCategories: definition.riskCategories.filter(item => item.id !== category.id) }); }}><Trash2 className="size-4" /></Button></div><details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Description (optional)</summary><Input className="mt-2" aria-label={`Description for ${category.label}`} value={category.interpretation} onChange={event => patch(category.id, { interpretation: event.target.value })} /></details></div>;
    })}</div><RangeErrors messages={messages} /><p className="text-xs text-muted-foreground">From and To are included. Every whole-number score must belong to exactly one category.</p></fieldset>;
}

export function FaceScanEditor({ definition, disabled, onChange, drafts, setDrafts }: EditorProps) {
  const config = normalizeFaceScanScoringConfig(definition.faceScanScoring ?? DEFAULT_FACE_SCAN_SCORING_CONFIG);
  const validation = faceScanRangeConfigSchema.safeParse(config);
  const messages = validation.success ? [] : validation.error.issues.map(issue => `${typeof issue.path[1] === "number" ? `Range ${issue.path[1] + 1}: ` : ""}${issue.message}`);
  const patch = (id: string, change: Partial<FaceScanRangeConfig["ranges"][number]>) => onChange({ ...definition, faceScanScoring: { ranges: config.ranges.map(range => range.id === id ? { ...range, ...change } : range) } });
  function addRange() {
    // Split the last range so adding a row starts with complete coverage.
    const last = config.ranges.at(-1)!;
    const middle = last.min + (last.max - last.min) / 2;
    if (middle <= last.min || middle >= last.max) return;
    onChange({ ...definition, faceScanScoring: { ranges: [...config.ranges.slice(0, -1), { ...last, max: middle, maxInclusive: true }, { ...last, id: newRuleId("face"), min: middle, minInclusive: false }] } });
    setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== `face-range:${last.id}:to`)));
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Face-scan scoring</h2><p className="mt-1 text-sm text-muted-foreground">Set points for each Overall Health Score range.</p></div><Button type="button" variant="outline" size="icon" aria-label="Add range" title="Add range" disabled={config.ranges.length >= 20} onClick={addRange}><Plus className="size-4" aria-hidden="true" /></Button></div><div className="divide-y rounded-lg border">{config.ranges.map((range, index) => <div key={range.id} className="space-y-2 p-3"><div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] items-start gap-2 sm:gap-3"><NumberCell label="From (%)" draftKey={`face-range:${range.id}:from`} value={range.min} percent drafts={drafts} setDrafts={setDrafts} onChange={min => patch(range.id, { min })} /><NumberCell label="To (%)" draftKey={`face-range:${range.id}:to`} value={range.max} percent drafts={drafts} setDrafts={setDrafts} onChange={max => patch(range.id, { max })} /><NumberCell label="Points" draftKey={`face-points:${range.id}`} value={range.points} drafts={drafts} setDrafts={setDrafts} onChange={points => patch(range.id, { points })} /><Button type="button" variant="ghost" size="icon" className="mt-5 size-8 text-destructive" aria-label={`Remove range ${index + 1}`} title="Remove range" disabled={config.ranges.length <= 1} onClick={() => { setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`face-range:${range.id}:`) && key !== `face-points:${range.id}`))); onChange({ ...definition, faceScanScoring: { ranges: config.ranges.filter(item => item.id !== range.id) } }); }}><Trash2 className="size-4" aria-hidden="true" /></Button></div><p className="text-xs text-muted-foreground">{range.minInclusive ? "From" : "Above"} {range.min}% {range.maxInclusive ? "through" : "to below"} {range.max}%</p><details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Range details</summary><div className="mt-2 flex flex-wrap gap-4"><label className="flex items-center gap-2"><input type="checkbox" checked={range.minInclusive} onChange={event => patch(range.id, { minInclusive: event.target.checked })} />Include {range.min}%</label><label className="flex items-center gap-2"><input type="checkbox" checked={range.maxInclusive} onChange={event => patch(range.id, { maxInclusive: event.target.checked })} />Include {range.max}%</label></div></details></div>)}</div><RangeErrors messages={messages} /><p className="text-xs text-muted-foreground">Cover 0–100% without gaps or overlaps. This score is separate from the assessment.</p></fieldset>;
}
