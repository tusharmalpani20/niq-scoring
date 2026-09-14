import { useEffect, useRef, useState } from "react";
import type { RuleAnswers, RuleDefinition } from "@niq-scoring/contracts/rules";
import { QuestionnaireFields } from "./QuestionnaireFields";
import { newSample } from "./sample-model";
import type { RuleEvaluation } from "@niq-scoring/scoring-engine/rules";
import { request, message } from "../api";
import { ErrorNotice } from "../shared";
import { Button } from "../components/ui/button";

type Result = RuleEvaluation & { calculatedAt: string; ruleVersionId: string; checksum: string };
export function RulePreview({ definition, ruleId, revision, dirty, onChange, editable }: { definition: RuleDefinition; ruleId: string; revision: number; dirty: boolean; onChange: (definition: RuleDefinition) => void; editable: boolean }) {
  const [answers, setAnswers] = useState<RuleAnswers>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const snapshot = JSON.stringify({ definition, answers, revision });
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  useEffect(() => { setAnswers({}); setResult(null); setError(""); }, [definition]);
  return <section className="space-y-5"><p className="text-sm text-muted-foreground">Use synthetic answers to test this questionnaire. Preview does not consume scoring quota. Changing the definition clears these answers.</p>
    {dirty && <p role="status" className="text-sm">Save the draft before running its calculation.</p>}
    <QuestionnaireFields definition={definition} answers={answers} onChange={next => { setAnswers(next); setResult(null); }} disabled={busy} />
    <ErrorNotice error={error} /><div className="flex gap-2"><Button disabled={busy || dirty} onClick={async () => { setBusy(true); setError(""); setResult(null); try { const response = await request<Result>(`/admin/rules/${ruleId}/preview`, { revision, answers }); if (latestSnapshot.current === snapshot) setResult(response); } catch(cause) { setError(message(cause)); } finally { setBusy(false); } }}>{busy ? "Calculating…" : "Run preview"}</Button><Button variant="outline" disabled={busy} onClick={() => { setAnswers({}); setResult(null); }}>Clear answers</Button>{editable && <Button variant="outline" disabled={busy || definition.samples.length >= 100} onClick={() => onChange({ ...definition, samples: [...definition.samples, newSample(answers)] })}>Use answers as a sample</Button>}</div>
    {result && <section className="space-y-4 rounded-lg border p-4" aria-label="Preview result"><h3 className="font-medium">{result.complete ? `Score: ${result.score} · ${result.classification?.label}` : "Incomplete assessment"}</h3>{result.classification?.interpretation && <p>{result.classification.interpretation}</p>}
      <dl className="grid gap-2 sm:grid-cols-2">{Object.entries(result.calculations).map(([id, value]) => <div key={id}><dt className="text-sm text-muted-foreground">{definition.calculations.find(c => c.id === id)?.label ?? id}</dt><dd>{value ?? "Unavailable"}</dd></div>)}{Object.entries(result.domains).map(([id, value]) => <div key={id}><dt className="text-sm text-muted-foreground">{definition.domains.find(d => d.id === id)?.label ?? id}</dt><dd>{value ?? "Incomplete"}</dd></div>)}</dl>
      {result.components.map(c => <p key={c.id} className="text-sm">{c.label}: {c.points ?? "Incomplete"}</p>)}
      {result.interventions.length > 0 && <section aria-label="Triggered guidance" className="space-y-3"><h4 className="font-medium">Triggered guidance</h4>{result.interventions.map(item => <div key={item.id}><p className="font-medium">{item.label}</p><p className="text-sm">{item.text}</p></div>)}</section>}
      {result.issues.length > 0 && <ul className="space-y-2 text-sm" aria-label="Preview issues">{result.issues.map((issue, index) => <li key={index}>{issue.path}: {issue.message}</li>)}</ul>}
      <p className="text-xs text-muted-foreground">Calculated {new Date(result.calculatedAt).toLocaleString()} · revision {revision}</p>
    </section>}
  </section>;
}
