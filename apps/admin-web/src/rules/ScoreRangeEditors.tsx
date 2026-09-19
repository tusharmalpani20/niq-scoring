import type { Dispatch, SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { DEFAULT_FACE_SCAN_SCORING_CONFIG, type FaceScanScoringConfig } from "@niq-scoring/contracts/face-scan-scoring";
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

export function SimpleRiskEditor({ definition, disabled, onChange, drafts, setDrafts }: EditorProps) {
  const patch = (id: string, change: Partial<FinalAssessmentDefinition["riskCategories"][number]>) => onChange({ ...definition, riskCategories: definition.riskCategories.map(category => category.id === id ? { ...category, ...change } : category) });
  const clearDraft = (prefix: string) => setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix))));
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Risk categories</h2><p className="mt-1 text-sm text-muted-foreground">Match the total assessment score to a category.</p></div><Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...definition, riskCategories: [...definition.riskCategories, { id: newRuleId("category"), label: "New category", interpretation: "", min: 0, max: null, minInclusive: true, maxInclusive: true, sources: [] }] })}><Plus className="size-4" />Add category</Button></div>
    <div className="divide-y rounded-lg border">{definition.riskCategories.map(category => {
      // Present equivalent inclusive integer endpoints without rewriting historical definitions on render.
      const from = category.min === null ? 0 : Math.max(0, category.minInclusive ? Math.ceil(category.min) : Math.floor(category.min) + 1);
      const to = category.max === null ? null : category.maxInclusive ? Math.floor(category.max) : Math.ceil(category.max) - 1;
      return <div key={category.id} className="space-y-2 p-3"><div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-start gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_2rem]"><label className="col-span-2 min-w-0 space-y-1 text-sm md:col-span-1"><span className="text-xs text-muted-foreground">Category name</span><Input className="h-9 shadow-none" value={category.label} onChange={event => patch(category.id, { label: event.target.value })} /></label><div className="col-start-1 md:col-start-auto"><NumberCell label="From score" draftKey={`risk:${category.id}:from`} value={from} drafts={drafts} setDrafts={setDrafts} onChange={min => patch(category.id, { min, minInclusive: true })} /></div><div className="min-w-0 space-y-2">{to !== null ? <NumberCell label="To score" draftKey={`risk:${category.id}:to`} value={to} drafts={drafts} setDrafts={setDrafts} onChange={max => patch(category.id, { max, maxInclusive: true })} /> : <div className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">To score</span><div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-muted-foreground">No limit</div></div>}<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={to === null} onChange={event => { clearDraft(`risk:${category.id}:to`); patch(category.id, { max: event.target.checked ? null : from, maxInclusive: true }); }} />No upper limit</label></div><Button type="button" variant="ghost" size="icon" className="col-start-3 row-start-1 size-8 text-destructive md:col-start-4 md:mt-5" aria-label={`Remove ${category.label}`} disabled={definition.riskCategories.length <= 1} onClick={() => { clearDraft(`risk:${category.id}:`); onChange({ ...definition, riskCategories: definition.riskCategories.filter(item => item.id !== category.id) }); }}><Trash2 className="size-4" /></Button></div><details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Description (optional)</summary><Input className="mt-2" aria-label={`Description for ${category.label}`} value={category.interpretation} onChange={event => patch(category.id, { interpretation: event.target.value })} /></details></div>;
    })}</div><p className="text-xs text-muted-foreground">From and To are included. Every whole-number score must belong to exactly one category.</p></fieldset>;
}

export function FaceScanEditor({ definition, disabled, onChange, drafts, setDrafts }: EditorProps) {
  const config = definition.faceScanScoring ?? DEFAULT_FACE_SCAN_SCORING_CONFIG;
  const patch = (change: Partial<FaceScanScoringConfig>) => onChange({ ...definition, faceScanScoring: { ...config, ...change } });
  const rows = [
    { label: `Below ${config.lowerThreshold}%`, key: "belowPoints" as const },
    { label: `${config.lowerThreshold}–${config.upperThreshold}% (including both)`, key: "middlePoints" as const },
    { label: `Above ${config.upperThreshold}%`, key: "abovePoints" as const },
  ];
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5"><div><h2 className="font-semibold">Face-scan scoring</h2><p className="mt-1 text-sm text-muted-foreground">Overall Health Score, scored separately from the assessment.</p></div><div className="grid grid-cols-2 gap-3"><NumberCell label="First cutoff (%)" draftKey="face-threshold:lower" value={config.lowerThreshold} percent drafts={drafts} setDrafts={setDrafts} onChange={lowerThreshold => patch({ lowerThreshold })} /><NumberCell label="Second cutoff (%)" draftKey="face-threshold:upper" value={config.upperThreshold} percent drafts={drafts} setDrafts={setDrafts} onChange={upperThreshold => patch({ upperThreshold })} /></div>{config.lowerThreshold >= config.upperThreshold && <p role="alert" className="text-sm text-destructive">The second cutoff must be greater than the first.</p>}<div className="overflow-hidden rounded-lg border"><div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3 bg-muted/40 px-3 py-2 text-xs font-medium"><span>Health score</span><span>Points</span></div><div className="divide-y">{rows.map(row => <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 px-3 py-2"><span className="text-sm">{row.label}</span><NumberCell hideLabel label={`${row.label} points`} draftKey={`face-points:${row.key}`} value={config[row.key]} drafts={drafts} setDrafts={setDrafts} onChange={points => patch({ [row.key]: points })} /></div>)}</div></div><p className="text-xs text-muted-foreground">Cutoffs accept decimals. Scores exactly at either cutoff use the middle row. Missing scores stay unanswered; invalid scores are rejected.</p></fieldset>;
}
