import { useEffect, useMemo, useState } from "react";
import { message, request } from "./api";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { ReportAiTrace } from "./ReportAiTrace";

type Call = {
  step: "writer" | "reviewer" | "revision";
  status: "SUCCEEDED" | "FAILED";
  model: string;
  provider: string | null;
  generationId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningEffort?: "medium" | "default" | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  errorCode: string | null;
};
type Run = {
  id: string;
  clientId: string;
  clientName?: string;
  deploymentId: string;
  deploymentName?: string;
  ruleVersionId: string;
  checksum: string;
  status: "PROCESSING" | "READY" | "REVIEW_REQUIRED" | "FAILED";
  model: string;
  promptVersion: string;
  schemaVersion: number;
  generationMode?: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  calls: Call[];
};
type RunPage = { items: Run[]; total: number; page: number; pageSize: number };

const pageSize = 20;
const formatNumber = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString();
const formatCost = (value: number | null) => value === null ? "—" : `$${value.toFixed(value < 0.01 ? 5 : 3)}`;
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const stepLabel = (step: string) => step === "revision" ? "Writer revision" : step;
const providerLabel = (provider: string | null) => provider === "codex-subscription" ? "Codex subscription" : provider ?? "—";
const modelLabel = (model: string) => /^(openai\/)?gpt-6-luna$/.test(model) ? "GPT-6 Luna" : /^(openai\/)?gpt-6\.1-sol$/.test(model) ? "GPT-6.1 Sol" : model;

export function ReportAiUsage() {
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<RunPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void request<RunPage>(`/admin/report-ai/runs?page=${page}&pageSize=${pageSize}`).then(result => {
      if (current) setData(result);
    }).catch(cause => {
      if (current) setError(message(cause));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [page, reload]);

  const pageTotals = useMemo(() => (data?.items ?? []).reduce((totals, run) => {
    totals.calls += run.calls.length;
    for (const call of run.calls) {
      totals.promptTokens += call.promptTokens ?? 0;
      totals.completionTokens += call.completionTokens ?? 0;
      if (call.cachedInputTokens != null) {
        totals.cachedInputTokens += call.cachedInputTokens;
        totals.cachedUsageCalls += 1;
      }
      totals.reasoningTokens += call.reasoningTokens ?? 0;
      if (call.costUsd !== null) {
        totals.costUsd += call.costUsd;
        totals.pricedCalls += 1;
      }
      if (call.provider === "codex-subscription") totals.subscriptionCalls += 1;
    }
    return totals;
  }, { calls: 0, promptTokens: 0, completionTokens: 0, cachedInputTokens: 0, cachedUsageCalls: 0, reasoningTokens: 0, costUsd: 0, pricedCalls: 0, subscriptionCalls: 0 }), [data]);
  const pageCost = pageTotals.pricedCalls > 0
    ? formatCost(pageTotals.costUsd)
    : pageTotals.subscriptionCalls > 0 ? "Codex subscription" : "Unavailable";
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  return <section className="min-w-0 space-y-5" aria-label="Report AI usage">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Generation runs</h2><p className="mt-1 text-sm text-muted-foreground">Usage summaries omit patient facts and generated wording. Open an individual agent trace to inspect retained prompts, responses, and review decisions.</p></div>
      <Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}>Refresh</Button>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 p-4 text-sm"><span>Could not load generation runs. {error}</span><Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>Try again</Button></div>}
    {loading && !data ? <p role="status" className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">Loading report AI usage…</p> : data && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Generation runs</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data.total.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">All pages</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Model calls</p><p className="mt-1 text-2xl font-semibold tabular-nums">{pageTotals.calls.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">This page</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Recorded provider cost</p><p className="mt-1 text-2xl font-semibold tabular-nums">{pageCost}</p><p className="mt-1 text-xs text-muted-foreground">{pageTotals.pricedCalls > 0 ? `This page, in USD · ${pageTotals.pricedCalls} of ${pageTotals.calls} calls have recorded costs` : "Per-call billing unavailable"}</p></div>
      </div>
      <p className="text-xs text-muted-foreground">This page: {pageTotals.promptTokens.toLocaleString()} input{pageTotals.cachedUsageCalls > 0 ? ` (${pageTotals.cachedInputTokens.toLocaleString()} cached input tokens recorded)` : ""}, {pageTotals.completionTokens.toLocaleString()} output, {pageTotals.reasoningTokens.toLocaleString()} reasoning tokens. Provider usage may be unavailable for failed calls.</p>
      {data.items.length === 0 ? <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">No report text has been generated yet.</p> : <div className="space-y-3">{data.items.map(run => <article key={run.id} className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1"><p className="text-sm font-semibold">{run.clientName ?? run.clientId} · {run.deploymentName ?? run.deploymentId}</p><p className="text-xs text-muted-foreground">{formatTime(run.createdAt)} · Run {run.id}</p></div><Badge variant={run.status === "READY" ? "success" : run.status === "FAILED" ? "destructive" : "secondary"}>{run.status.replaceAll("_", " ").toLowerCase()}</Badge></div>
        <div className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4"><p><span className="text-muted-foreground">Rule version:</span> {run.ruleVersionId}</p><p><span className="text-muted-foreground">Model:</span> {modelLabel(run.model)}</p><p><span className="text-muted-foreground">Prompt:</span> {run.promptVersion}</p><p><span className="text-muted-foreground">Calls:</span> {run.calls.length}</p></div>
        {run.generationMode === "RULE_FALLBACK" && <p className="mt-2 text-xs font-medium text-amber-700">Rule-based fallback · agent narrative was not issued</p>}
        {run.generationMode === "SECTION_FALLBACK" && <p className="mt-2 text-xs font-medium text-amber-700">Section recovery · approved agent sections retained</p>}
        {run.errorCode && <p className="mt-3 text-xs text-destructive">Run error: {run.errorCode}</p>}
        <details className="mt-3 border-t pt-3 text-sm"><summary className="cursor-pointer font-medium text-primary">View model calls and usage</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="border-b bg-muted/40 text-muted-foreground"><tr><th className="p-2">Step</th><th className="p-2">Status</th><th className="p-2">Provider</th><th className="p-2 text-right">Input</th><th className="p-2 text-right">Cached input</th><th className="p-2 text-right">Output</th><th className="p-2 text-right">Reasoning</th><th className="p-2 text-right">Cost</th><th className="p-2 text-right">Time</th></tr></thead><tbody>{run.calls.map((call, index) => <tr key={`${call.step}-${index}`} className="border-b last:border-0"><td className="p-2 capitalize">{stepLabel(call.step)}</td><td className="p-2">{call.status.toLowerCase()}</td><td className="p-2">{providerLabel(call.provider)}{call.reasoningEffort && <span className="mt-1 block text-muted-foreground">Reasoning: {call.reasoningEffort}</span>}{call.model !== run.model && <span className="mt-1 block text-muted-foreground">{modelLabel(call.model)}</span>}</td><td className="p-2 text-right tabular-nums">{formatNumber(call.promptTokens)}</td><td className="p-2 text-right tabular-nums">{formatNumber(call.cachedInputTokens)}</td><td className="p-2 text-right tabular-nums">{formatNumber(call.completionTokens)}</td><td className="p-2 text-right tabular-nums">{formatNumber(call.reasoningTokens)}</td><td className="p-2 text-right tabular-nums">{call.provider === "codex-subscription" && call.costUsd === null ? "Subscription" : formatCost(call.costUsd)}</td><td className="p-2 text-right tabular-nums">{call.latencyMs === null ? "—" : `${(call.latencyMs / 1000).toFixed(1)}s`}</td></tr>)}</tbody></table></div>{run.calls.some(call => call.errorCode) && <ul className="mt-2 space-y-1 text-xs text-destructive">{run.calls.filter(call => call.errorCode).map((call, index) => <li key={`${call.step}-${index}`}>{call.step}: {call.errorCode}</li>)}</ul>}</details>
        <ReportAiTrace runId={run.id} />
      </article>)}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-muted-foreground">Page {data.page} of {lastPage}</p><div className="flex gap-2"><Button variant="outline" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><Button variant="outline" disabled={loading || page >= lastPage} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>
    </>}
  </section>;
}
