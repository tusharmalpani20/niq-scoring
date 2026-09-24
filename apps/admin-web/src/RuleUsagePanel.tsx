import { lazy, Suspense } from "react";
import { Button } from "./components/ui/button";
import { useRuleUsage } from "./rule-usage";

const RuleUsageChart = lazy(() => import("./RuleUsageChart").then(module => ({ default: module.RuleUsageChart })));

export function RuleUsagePanel({ clientId }: { clientId?: string }) {
  const { rules, error, retry } = useRuleUsage(clientId);
  if (error) return <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load rule usage. {error}<Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>;
  return <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading chart…</p>}><RuleUsageChart rules={rules} /></Suspense>;
}
