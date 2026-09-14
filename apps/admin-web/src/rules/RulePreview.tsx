import { useEffect, useState } from "react";
import type { RuleAnswers, RuleDefinition } from "@niq-scoring/contracts/rules";
import { prepareAnswers } from "@niq-scoring/scoring-engine/answers";
import type { RuleEvaluation } from "@niq-scoring/scoring-engine/rules";
import { request, message } from "../api";
import { ErrorNotice } from "../shared";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { NativeSelect } from "../components/ui/native-select";
import { Label } from "../components/ui/label";

type Result = RuleEvaluation & { calculatedAt: string; ruleVersionId: string; checksum: string };
export function RulePreview({ definition, ruleId, revision, dirty }: { definition: RuleDefinition; ruleId: string; revision: number; dirty: boolean }) {
  const [answers, setAnswers] = useState<RuleAnswers>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const prepared = prepareAnswers(definition, answers);
  useEffect(() => { setAnswers({}); setResult(null); setError(""); }, [definition]);
  function answer(id: string, value: RuleAnswers[string]) { setAnswers(current => ({ ...current, [id]: value })); setResult(null); }
  return <section className="space-y-5"><p className="text-sm text-muted-foreground">Use synthetic answers to test this questionnaire. Preview does not consume scoring quota. Changing the definition clears these answers.</p>
    {dirty && <p role="status" className="text-sm">Save the draft before running its calculation.</p>}
    {definition.sections.map(section => <fieldset key={section.id} disabled={busy} className="space-y-4 rounded-lg border p-4"><legend className="px-2 font-medium">{section.title}</legend>{section.description && <p className="text-sm text-muted-foreground">{section.description}</p>}
      {section.questions.filter(q => prepared.visible[q.id]).map(q => { const value = answers[q.id]; const id = `preview-${q.id}`; return <div key={q.id} className="space-y-2"><Label htmlFor={id}>{q.label}{q.required ? " *" : ""}{q.unit ? ` (${q.unit})` : ""}</Label>
        {q.type === "boolean" || q.type === "single_select" ? <NativeSelect id={id} value={value == null ? "" : String(value)} onChange={e => answer(q.id, e.target.value === "" ? null : q.type === "boolean" ? e.target.value === "true" : e.target.value)}><option value="">Select an answer</option>{q.type === "boolean" ? <><option value="true">Yes</option><option value="false">No</option></> : q.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect>
        : q.type === "multi_select" ? <fieldset id={id} className="grid gap-2 sm:grid-cols-2" aria-label={q.label}>{q.options.map(o => <Label key={o.id} className="flex gap-2 font-normal"><input type="checkbox" checked={Array.isArray(value) && value.includes(o.id)} onChange={e => { const selected = Array.isArray(value) ? value : []; answer(q.id, e.target.checked ? [...selected, o.id] : selected.filter(v => v !== o.id)); }} />{o.label}</Label>)}</fieldset>
        : q.type === "long_text" ? <Textarea id={id} value={typeof value === "string" ? value : ""} maxLength={q.validation.maxLength} onChange={e => answer(q.id, e.target.value)} />
        : <Input id={id} type={q.type === "number" || q.type === "date" ? q.type : "text"} step={q.validation.integer ? 1 : "any"} min={q.type === "date" ? q.validation.minDate : q.validation.min} max={q.type === "date" ? q.validation.maxDate : q.validation.max} maxLength={q.validation.maxLength} value={typeof value === "number" || typeof value === "string" ? value : ""} onChange={e => answer(q.id, q.type === "number" ? e.target.value === "" ? null : Number(e.target.value) : e.target.value)} />}
        {q.help && <p className="text-sm text-muted-foreground">{q.help}</p>}
      </div>; })}</fieldset>)}
    <ErrorNotice error={error} /><div className="flex gap-2"><Button disabled={busy || dirty} onClick={async () => { setBusy(true); setError(""); setResult(null); try { setResult(await request<Result>(`/admin/rules/${ruleId}/preview`, { revision, answers })); } catch(cause) { setError(message(cause)); } finally { setBusy(false); } }}>{busy ? "Calculating…" : "Run preview"}</Button><Button variant="outline" disabled={busy} onClick={() => { setAnswers({}); setResult(null); }}>Clear answers</Button></div>
    {result && <section className="space-y-4 rounded-lg border p-4" aria-label="Preview result"><h3 className="font-medium">{result.complete ? `Score: ${result.score} · ${result.classification?.label}` : "Incomplete assessment"}</h3>{result.classification?.interpretation && <p>{result.classification.interpretation}</p>}
      <dl className="grid gap-2 sm:grid-cols-2">{Object.entries(result.calculations).map(([id, value]) => <div key={id}><dt className="text-sm text-muted-foreground">{definition.calculations.find(c => c.id === id)?.label ?? id}</dt><dd>{value ?? "Unavailable"}</dd></div>)}{Object.entries(result.domains).map(([id, value]) => <div key={id}><dt className="text-sm text-muted-foreground">{definition.domains.find(d => d.id === id)?.label ?? id}</dt><dd>{value ?? "Incomplete"}</dd></div>)}</dl>
      {result.components.map(c => <p key={c.id} className="text-sm">{c.label}: {c.points ?? "Incomplete"}</p>)}
      {result.interventions.length > 0 && <section aria-label="Triggered guidance" className="space-y-3"><h4 className="font-medium">Triggered guidance</h4>{result.interventions.map(item => <div key={item.id}><p className="font-medium">{item.label}</p><p className="text-sm">{item.text}</p></div>)}</section>}
      {result.issues.length > 0 && <ul className="space-y-2 text-sm" aria-label="Preview issues">{result.issues.map((issue, index) => <li key={index}>{issue.path}: {issue.message}</li>)}</ul>}
      <p className="text-xs text-muted-foreground">Calculated {new Date(result.calculatedAt).toLocaleString()} · revision {revision}</p>
    </section>}
  </section>;
}
