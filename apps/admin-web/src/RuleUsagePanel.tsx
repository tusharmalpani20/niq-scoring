import { lazy, Suspense } from "react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { useRuleUsage } from "./rule-usage";
import type { RuleUsage } from "./rule-usage";

const RuleUsageChart = lazy(() => import("./RuleUsageChart").then(module => ({ default: module.RuleUsageChart })));

function ClientRuleBreakdown({ rules }: { rules: RuleUsage[] | null }) {
  const rows = rules?.filter(rule => rule.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) ?? [];
  const total = rows.reduce((sum, rule) => sum + rule.count, 0);
  const renderRow = (rule: RuleUsage, index: number) => <li key={rule.ruleVersionId ?? `${rule.name}-${index}`} className="space-y-2 py-3 first:pt-0 last:pb-0">
    <div className="flex items-baseline justify-between gap-4 text-sm"><span className="min-w-0 truncate font-medium" title={rule.name}>{rule.name}</span><span className="shrink-0 tabular-nums">{rule.count.toLocaleString()} <span className="font-normal text-muted-foreground">{rule.count === 1 ? "assessment" : "assessments"}</span></span></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-label={`${rule.name}: ${Math.round(rule.count / total * 100)}% of scored assessments`} role="img"><div className="h-full rounded-full bg-primary" style={{ width: `${rule.count / total * 100}%` }} /></div>
  </li>;
  return <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>Assessments by rule</CardTitle><span className="text-xs text-muted-foreground">All time</span></CardHeader><CardContent>
    {rules === null ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading rule usage…</p>
      : rows.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No assessments scored yet.</p>
      : <><ul className="divide-y">{rows.slice(0, 5).map(renderRow)}</ul>{rows.length > 5 && <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-sm font-medium text-primary">Show {rows.length - 5} more {rows.length === 6 ? "rule" : "rules"}</summary><ul className="mt-3 divide-y">{rows.slice(5).map((rule, index) => renderRow(rule, index + 5))}</ul></details>}</>}
  </CardContent></Card>;
}

export function RuleUsagePanel({ clientId }: { clientId?: string }) {
  const { rules, error, retry } = useRuleUsage(clientId);
  if (error) return <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load rule usage. {error}<Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>;
  if (clientId) return <ClientRuleBreakdown rules={rules} />;
  return <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading chart…</p>}><RuleUsageChart rules={rules} /></Suspense>;
}
