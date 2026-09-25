import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FinalAssessmentDefinition, RiskCategoryColor } from "@niq-scoring/contracts/final-assessment";
import { faceScanRangeConfigSchema, DEFAULT_FACE_SCAN_SCORING_CONFIG, normalizeFaceScanScoringConfig, type FaceScanRangeConfig } from "@niq-scoring/contracts/face-scan-scoring";
import { validateFinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment-validation";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { newRuleId } from "./questionnaire-model";

type DraftProps = { drafts: Record<string, string>; setDrafts: Dispatch<SetStateAction<Record<string, string>>> };
type EditorProps = DraftProps & { definition: FinalAssessmentDefinition; disabled: boolean; onChange: (definition: FinalAssessmentDefinition) => void };

const riskColors: Array<{ value: RiskCategoryColor; label: string; swatch: string }> = [
  { value: "green", label: "Green", swatch: "bg-green-600" },
  { value: "amber", label: "Amber", swatch: "bg-amber-500" },
  { value: "red", label: "Red", swatch: "bg-red-600" },
  { value: "neutral", label: "Neutral", swatch: "bg-slate-500" },
  { value: "blue", label: "Blue", swatch: "bg-blue-600" },
  { value: "purple", label: "Purple", swatch: "bg-purple-600" },
];

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

function riskCoverageIssues(categories: FinalAssessmentDefinition["riskCategories"]) {
  const byRow = new Map<string, string[]>();
  const add = (id: string, message: string) => byRow.set(id, [...(byRow.get(id) ?? []), message]);
  const rows = categories.map(category => ({
    id: category.id,
    label: category.label.trim() || "Unnamed category",
    from: category.min === null ? 0 : Math.max(0, category.minInclusive ? Math.ceil(category.min) : Math.floor(category.min) + 1),
    to: category.max === null ? Infinity : category.maxInclusive ? Math.floor(category.max) : Math.ceil(category.max) - 1,
  })).sort((a, b) => a.from - b.from);
  for (const row of rows) {
    if (row.to >= row.from) continue;
    add(row.id, "The end score must be at least the start score.");
  }
  const valid = rows.filter(row => row.to >= row.from);
  let coveredThrough = -1;
  for (let index = 0; index < valid.length; index++) {
    const row = valid[index]!;
    if (row.from > coveredThrough + 1) {
      const gap = `scores ${coveredThrough + 1}–${row.from - 1}`;
      add(row.id, coveredThrough < 0 ? `Scores 0–${row.from - 1} are not covered. Start a range at 0.` : `Gap before this category: ${gap} are not covered.`);
    }
    for (const other of valid.slice(0, index)) {
      const start = Math.max(row.from, other.from);
      const end = Math.min(row.to, other.to);
      if (start > end) continue;
      const where = end === Infinity ? `from ${start} points onward` : start === end ? `at ${start} points` : `at ${start}–${end} points`;
      add(row.id, `Overlaps ${other.label} ${where}.`);
      add(other.id, `Overlaps ${row.label} ${where}.`);
    }
    if (row.to > coveredThrough) coveredThrough = row.to;
  }
  const highest = valid.reduce<(typeof valid)[number] | null>((best, row) => !best || row.to > best.to ? row : best, null);
  if (highest && highest.to !== Infinity) {
    add(highest.id, `Scores above ${highest.to} are not covered. Add a category or choose No upper limit.`);
  }
  return byRow;
}

export function SimpleRiskEditor({ definition, disabled, onChange, drafts, setDrafts }: EditorProps) {
  const [editedRangeId, setEditedRangeId] = useState<string | null>(null);
  const patch = (id: string, change: Partial<FinalAssessmentDefinition["riskCategories"][number]>) => {
    if ("min" in change || "max" in change || "minInclusive" in change || "maxInclusive" in change) setEditedRangeId(id);
    onChange({ ...definition, riskCategories: definition.riskCategories.map(category => category.id === id ? { ...category, ...change } : category) });
  };
  const coverage = riskCoverageIssues(definition.riskCategories);
  const affectedRangeId = editedRangeId && coverage.has(editedRangeId) ? editedRangeId : coverage.keys().next().value;
  const nameIssues = new Map<string, string>();
  const seenNames = new Set<string>();
  for (const category of definition.riskCategories) {
    const name = category.label.trim().replace(/\s+/g, " ").toLowerCase();
    if (!name) nameIssues.set(category.id, "Enter a category name.");
    else if (seenNames.has(name)) nameIssues.set(category.id, "Use a different category name.");
    seenNames.add(name);
  }
  const messages = validateFinalAssessmentDefinition(definition).filter(issue => issue.path.startsWith("riskCategories") && issue.code !== "RISK_RANGE_COVERAGE" && issue.code !== "DUPLICATE_CATEGORY_NAME").map(issue => issue.message);
  const clearDraft = (prefix: string) => setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix))));
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Risk categories</h2><p className="mt-1 text-sm text-muted-foreground">Give each total score a risk category.</p></div><Button type="button" variant="outline" size="sm" disabled={definition.riskCategories.length >= 20} onClick={() => { const id = newRuleId("category"); setEditedRangeId(id); onChange({ ...definition, riskCategories: [...definition.riskCategories, { id, label: "New category", color: "neutral", interpretation: "", min: 0, max: null, minInclusive: true, maxInclusive: true, sources: [] }] }); }}><Plus className="size-4" aria-hidden="true" />Add category</Button></div>
    <div className="divide-y rounded-lg border">{definition.riskCategories.map(category => {
      // Present equivalent inclusive integer endpoints without rewriting historical definitions on render.
      const from = category.min === null ? 0 : Math.max(0, category.minInclusive ? Math.ceil(category.min) : Math.floor(category.min) + 1);
      const to = category.max === null ? null : category.maxInclusive ? Math.floor(category.max) : Math.ceil(category.max) - 1;
      const rowIssues = category.id === affectedRangeId ? coverage.get(category.id) ?? [] : [];
      return <div key={category.id} role="group" aria-label={`Risk category ${category.label}`} aria-invalid={rowIssues.length > 0} tabIndex={rowIssues.length ? -1 : undefined} className={`space-y-3 p-3 sm:p-4 ${rowIssues.length ? "border-l-2 border-destructive bg-destructive/5" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="font-medium">{to === null ? `${from} points and above` : `${from}–${to} points`}</h3><p className="text-xs text-muted-foreground">Total assessment score</p></div>
          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-destructive" aria-label={`Remove ${category.label}`} title={`Remove ${category.label}`} disabled={definition.riskCategories.length <= 1} onClick={() => { clearDraft(`risk:${category.id}:`); if (editedRangeId === category.id) setEditedRangeId(null); onChange({ ...definition, riskCategories: definition.riskCategories.filter(item => item.id !== category.id) }); }}><Trash2 className="size-4" aria-hidden="true" /></Button>
        </div>
        {rowIssues.length > 0 && <p role="alert" aria-label="Score range issue" className="text-sm text-destructive"><span className="font-medium">Fix this score range.</span> {rowIssues.join(" ")}</p>}
        <label className="block min-w-0 space-y-1 text-sm"><span className="text-xs text-muted-foreground">Category name</span><Input id={`risk-category-name-${category.id}`} className="h-9 shadow-none" value={category.label} aria-invalid={nameIssues.has(category.id)} aria-describedby={nameIssues.has(category.id) ? `risk-category-name-error-${category.id}` : undefined} onChange={event => patch(category.id, { label: event.target.value })} />{nameIssues.has(category.id) && <span id={`risk-category-name-error-${category.id}`} role="alert" className="text-xs text-destructive">{nameIssues.get(category.id)}</span>}</label>
        <div className="space-y-1.5 text-sm"><p className="text-xs text-muted-foreground">Category color</p><div role="group" aria-label={`Color for ${category.label}`} className="flex flex-wrap gap-2">{riskColors.map(color => <button key={color.value} type="button" aria-pressed={(category.color ?? "neutral") === color.value} onClick={() => patch(category.id, { color: color.value })} className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${(category.color ?? "neutral") === color.value ? "border-primary bg-primary/5 font-semibold" : "border-border"}`}><span aria-hidden="true" className={`size-3 rounded-full ${color.swatch}`} />{color.label}</button>)}</div></div>
        <details className="text-sm"><summary className="cursor-pointer text-primary">Edit score range</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <NumberCell label="From score" draftKey={`risk:${category.id}:from`} value={from} drafts={drafts} setDrafts={setDrafts} onChange={min => patch(category.id, { min, minInclusive: true })} />
            <div className="min-w-0 space-y-2">{to !== null ? <NumberCell label="To score" draftKey={`risk:${category.id}:to`} value={to} drafts={drafts} setDrafts={setDrafts} onChange={max => patch(category.id, { max, maxInclusive: true })} /> : <div className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">To score</span><div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-muted-foreground">No limit</div></div>}<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={to === null} onChange={event => { clearDraft(`risk:${category.id}:to`); patch(category.id, { max: event.target.checked ? null : from, maxInclusive: true }); }} />No upper limit</label></div>
          </div>
        </details>
        <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Description (optional)</summary><Input className="mt-2" aria-label={`Description for ${category.label}`} value={category.interpretation} onChange={event => patch(category.id, { interpretation: event.target.value })} /></details>
      </div>;
    })}</div><RangeErrors messages={messages} /><p className="text-xs text-muted-foreground">Score ranges include both ends and must cover every whole-number total without gaps or overlaps.</p></fieldset>;
}

function vitalIqRangeText(range: FaceScanRangeConfig["ranges"][number]): string {
  if (range.min === 0 && range.minInclusive && range.max === 100 && range.maxInclusive) return "All scores (0–100)";
  if (range.min === 0 && range.minInclusive) return range.maxInclusive ? `Up to ${range.max}` : `Below ${range.max}`;
  if (range.max === 100 && range.maxInclusive) return range.minInclusive ? `${range.min} and above` : `Above ${range.min}`;
  return `${range.minInclusive ? "From" : "Above"} ${range.min} ${range.maxInclusive ? "through" : "to below"} ${range.max}`;
}

function vitalIqIssueText(message: string, currentRange: number): string {
  const overlap = message.match(/^Rows (\d+) and (\d+) overlap between scores ([\d.]+) and ([\d.]+)\./);
  if (overlap) {
    const other = Number(overlap[1]) === currentRange ? Number(overlap[2]) : Number(overlap[1]);
    const boundary = currentRange < other ? "To" : "From";
    return `Scores ${overlap[3]}–${overlap[4]} are also in range ${other}. Adjust this range’s ${boundary} score so the ranges meet without overlapping.`;
  }
  const shared = message.match(/^Rows (\d+) and (\d+) both include score ([\d.]+)\./);
  if (shared) {
    const other = Number(shared[1]) === currentRange ? Number(shared[2]) : Number(shared[1]);
    return `Score ${shared[3]} is also included in range ${other}. Include it in only one range.`;
  }
  const gap = message.match(/^There is a gap between scores ([\d.]+) and ([\d.]+)\./);
  if (gap) return `Scores between ${gap[1]} and ${gap[2]} are not covered. Move this range’s From score to meet the previous range.`;
  return message;
}

export function FaceScanEditor({ definition, disabled, onChange, drafts, setDrafts }: EditorProps) {
  const [editedRangeId, setEditedRangeId] = useState<string | null>(null);
  const config = normalizeFaceScanScoringConfig(definition.faceScanScoring ?? DEFAULT_FACE_SCAN_SCORING_CONFIG);
  const validation = faceScanRangeConfigSchema.safeParse(config);
  const messages = validation.success ? [] : validation.error.issues.map(issue =>
    `${issue.code !== "custom" && typeof issue.path[1] === "number" ? `Range ${issue.path[1] + 1}: ` : ""}${issue.message}`);
  const firstIssueIndex = validation.success ? -1 : validation.error.issues.find(issue => typeof issue.path[1] === "number")?.path[1];
  const affectedRangeId = messages.length ? editedRangeId && config.ranges.some(range => range.id === editedRangeId) ? editedRangeId : config.ranges[typeof firstIssueIndex === "number" ? firstIssueIndex : 0]?.id : null;
  const patch = (id: string, change: Partial<FaceScanRangeConfig["ranges"][number]>) => {
    if ("min" in change || "max" in change || "minInclusive" in change || "maxInclusive" in change) setEditedRangeId(id);
    onChange({ ...definition, faceScanScoring: { ranges: config.ranges.map(range => range.id === id ? { ...range, ...change } : range) } });
  };

  function addRange() {
    // Splitting the final band keeps coverage valid while the user edits it.
    const last = config.ranges.at(-1)!;
    const middle = last.min + (last.max - last.min) / 2;
    if (middle <= last.min || middle >= last.max) return;
    const id = newRuleId("face");
    setEditedRangeId(id);
    onChange({ ...definition, faceScanScoring: { ranges: [
      ...config.ranges.slice(0, -1),
      { ...last, max: middle, maxInclusive: true },
      { ...last, id, label: "", min: middle, minInclusive: false },
    ] } });
    setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== `face-range:${last.id}:to`)));
  }

  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">Vital IQ scoring</h2><p className="mt-1 text-sm text-muted-foreground">Assign NIQ points using the Overall Health Score (0–100).</p></div>
      <Button type="button" variant="outline" size="sm" disabled={config.ranges.length >= 20} onClick={addRange}><Plus className="size-4" aria-hidden="true" />Add range</Button>
    </div>
    <div className="divide-y rounded-lg border">{config.ranges.map((range, index) => <div key={range.id} role="group" aria-label={`Vital IQ range ${index + 1}`} aria-invalid={range.id === affectedRangeId} tabIndex={range.id === affectedRangeId ? -1 : undefined} className={`space-y-3 p-3 sm:p-4 ${range.id === affectedRangeId ? "border-l-2 border-destructive bg-destructive/5" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="font-medium">{vitalIqRangeText(range)}</h3><p className="text-xs text-muted-foreground">Overall Health Score · Range {index + 1}</p></div>
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-destructive" aria-label={`Remove range ${index + 1}`} title="Remove range" disabled={config.ranges.length <= 1} onClick={() => {
          setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`face-range:${range.id}:`) && key !== `face-points:${range.id}`)));
          if (editedRangeId === range.id) setEditedRangeId(null);
          onChange({ ...definition, faceScanScoring: { ranges: config.ranges.filter(item => item.id !== range.id) } });
        }}><Trash2 className="size-4" aria-hidden="true" /></Button>
      </div>
      {range.id === affectedRangeId && <div role="alert" aria-label="Vital IQ range issue" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"><p className="font-medium">Check this score range</p><ul className="mt-1 space-y-1">{[...new Set(messages)].map(issue => <li key={issue}>{vitalIqIssueText(issue, index + 1)}</li>)}</ul></div>}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-end">
        <label className="block min-w-0 space-y-1 text-sm"><span className="text-xs text-muted-foreground">Label (optional)</span><Input className="h-9 shadow-none" maxLength={80} placeholder="What is this range for?" value={range.label ?? ""} onChange={event => patch(range.id, { label: event.target.value })} /></label>
        <NumberCell label="NIQ points" draftKey={`face-points:${range.id}`} value={range.points} drafts={drafts} setDrafts={setDrafts} onChange={points => patch(range.id, { points })} />
      </div>
      <details className="text-sm"><summary className="cursor-pointer text-primary">Edit score boundaries</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2"><NumberCell label="From score" draftKey={`face-range:${range.id}:from`} value={range.min} percent drafts={drafts} setDrafts={setDrafts} onChange={min => patch(range.id, { min })} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={range.minInclusive} onChange={event => patch(range.id, { minInclusive: event.target.checked })} />Include {range.min}</label></div>
          <div className="space-y-2"><NumberCell label="To score" draftKey={`face-range:${range.id}:to`} value={range.max} percent drafts={drafts} setDrafts={setDrafts} onChange={max => patch(range.id, { max })} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={range.maxInclusive} onChange={event => patch(range.id, { maxInclusive: event.target.checked })} />Include {range.max}</label></div>
        </div>
      </details>
    </div>)}</div>
    <p className="text-xs text-muted-foreground">Ranges must cover 0–100 without gaps or overlaps. Vital IQ points are separate from questionnaire points.</p>
  </fieldset>;
}
