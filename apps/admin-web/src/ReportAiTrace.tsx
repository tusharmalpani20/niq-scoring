import { useEffect, useState } from "react";
import { message, request } from "./api";
import { Button } from "./components/ui/button";

export type ReportTrace = {
  run: { id: string; promptVersion: string; schemaVersion: number; status: string };
  retentionDays: number;
  calls: Array<{
    id: string; attemptId: string; sequence: number; step: string;
    system: string; user: string; schema: unknown; response: unknown;
    usage: unknown; errorCode: string | null; createdAt: string;
    completedAt: string | null; expiresAt: string;
  }>;
  events: Array<{ id: string; attemptId: string; stage: string; payload: unknown; createdAt: string; expiresAt: string }>;
};

const plainText = (value: unknown) => typeof value === "string" ? value : value == null ? "Not recorded" : JSON.stringify(value, null, 2);

function TraceValue({ label, value }: { label: string; value: unknown }) {
  return <details className="min-w-0 rounded border p-3">
    <summary className="cursor-pointer font-medium">{label}</summary>
    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs [overflow-wrap:anywhere]">{plainText(value)}</pre>
  </details>;
}

export function ReportTraceContent({ trace }: { trace: ReportTrace }) {
  return <div className="min-w-0 space-y-3">
    <p className="break-words text-xs text-muted-foreground">Prompt: {trace.run.promptVersion} · Schema: {trace.run.schemaVersion} · Run: {trace.run.status}</p>
    <p className="text-xs text-muted-foreground">Assessment-derived messages are restricted to administrators and retained for {trace.retentionDays} days. Messages are displayed as plain text.</p>
    {trace.calls.length === 0 && trace.events.length === 0 && <p role="status" className="rounded border p-3">No retained trace is available. It was not captured or has expired; earlier messages cannot be reconstructed.</p>}
    {trace.calls.map(call => <details key={call.id} className="min-w-0 rounded border p-3">
      <summary className="cursor-pointer break-words font-medium">Call {call.sequence} · {call.step} · {call.errorCode ? "failed" : call.completedAt ? "completed" : "in progress"}</summary>
      <div className="mt-3 min-w-0 space-y-2">
        <p className="break-words text-xs text-muted-foreground">Attempt: {call.attemptId} · Sent: {call.createdAt} · Completed: {call.completedAt ?? "Pending"} · Expires: {call.expiresAt}</p>
        {call.errorCode && <p className="text-xs text-destructive">Error: {call.errorCode}</p>}
        <TraceValue label="System prompt" value={call.system} />
        <TraceValue label="User / task prompt" value={call.user} />
        <TraceValue label="Response schema" value={call.schema} />
        <TraceValue label="Agent response" value={call.response} />
        <TraceValue label="Model and usage" value={call.usage} />
      </div>
    </details>)}
    {trace.events.length > 0 && <details className="min-w-0 rounded border p-3"><summary className="cursor-pointer font-medium">Workflow decisions and review events ({trace.events.length})</summary>
      <ol className="mt-3 space-y-2">{trace.events.map(event => <li key={event.id} className="min-w-0 space-y-1">
        <p className="break-words text-xs text-muted-foreground">{event.createdAt} · Attempt: {event.attemptId} · Expires: {event.expiresAt}</p>
        <TraceValue label={event.stage} value={event.payload} />
      </li>)}</ol>
    </details>}
  </div>;
}

/** Sensitive content is fetched separately, only while explicitly opened, and cleared on close. */
export function ReportAiTrace({ runId }: { runId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [reload, setReload] = useState(0);
  const [trace, setTrace] = useState<ReportTrace | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setTrace(null);
    setError("");
    if (!expanded) return;
    let current = true;
    void request<ReportTrace>(`/admin/report-ai/runs/${encodeURIComponent(runId)}/trace`, undefined, "GET", { "Cache-Control": "no-store" })
      .then(result => { if (current) setTrace(result); })
      .catch(cause => { if (current) setError(message(cause)); });
    return () => { current = false; };
  }, [expanded, reload, runId]);
  return <div className="mt-3 min-w-0 border-t pt-3 text-sm">
    <Button variant="outline" size="sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Close agent trace" : "View agent trace"}</Button>
    {expanded && <div className="mt-3 min-w-0 space-y-3">
      <Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>Refresh agent trace</Button>
      {error ? <p role="alert">Could not load agent trace. {error}</p> : trace ? <ReportTraceContent trace={trace} /> : <p role="status">Loading agent trace…</p>}
    </div>}
  </div>;
}
