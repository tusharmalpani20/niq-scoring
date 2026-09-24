import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { message, request } from "./api";
import { Card, CardContent } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { deploymentUrl } from "./record-urls";
import type { Overview } from "./Operations";
import { RuleUsagePanel } from "./RuleUsagePanel";
import { DashboardClientUsage, type DashboardClient } from "./DashboardClientUsage";
import { DashboardMetricCard } from "./DashboardMetricCard";
import { deploymentDisplayLabel } from "./deployment-label";

const UsageChart = lazy(() => import("./UsageChart").then(module => ({ default: module.UsageChart })));

type Counts = { assessments: number; faceScans: number; failedRequests: number };
type Dashboard = {
  period: { current: string; previous: string; asOf: string };
  activity: { current: Counts; previous: Counts };
  monthlyUsage: Array<{ month: string } & Counts>;
  clients: DashboardClient[];
  attention: { failedScoring24h: number; disabledDeployments: number; expiringTokenDeployments: Array<{ deploymentId: string; count: number }>; nearLimitDeployments: Array<{ deploymentId: string; capability: "SCORING" | "FACE_SCAN"; used: number; limit: number }> };
};

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const deploymentIdentity = (overview: Overview, deployment: Overview["deployments"][number]) => {
  const client = overview.clients.find(record => record.id === deployment.clientId);
  return { client: client?.name ?? "Client", label: deploymentDisplayLabel(deployment) };
};

export function AdminDashboard({ overview }: { overview: Overview }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void request<Dashboard>("/admin/dashboard").then(result => { if (current) { setData(result); setError(""); } }).catch(cause => { if (current) setError(message(cause)); });
    return () => { current = false; };
  }, [attempt]);
  if (error) return <div role="alert" className="flex items-center gap-3 text-sm text-destructive">Could not load overview activity. {error}<Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>;
  if (!data) return <p role="status" className="py-12 text-sm text-muted-foreground">Loading overview activity…</p>;

  const alerts = [
    { key: "failed-scoring", count: data.attention.failedScoring24h, badge: String(data.attention.failedScoring24h), title: "Scoring requests failed", detail: "In the last 24 hours", to: null, urgent: true },
    { key: "disabled-deployments", count: data.attention.disabledDeployments, badge: String(data.attention.disabledDeployments), title: "Deployments disabled", detail: "Scoring and scans are blocked", to: "/deployments", urgent: false },
    ...data.attention.expiringTokenDeployments.flatMap(item => {
      const deployment = overview.deployments.find(record => record.id === item.deploymentId);
      if (!deployment) return [];
      const identity = deploymentIdentity(overview, deployment);
      return [{ key: `expiring-tokens-${item.deploymentId}`, count: item.count, badge: String(item.count), title: item.count === 1 ? "Unused activation token expires soon" : "Unused activation tokens expire soon",
        detail: `${identity.client} · ${identity.label} · ${item.count} ${item.count === 1 ? "token expires" : "tokens expire"} within 7 days`, to: deploymentUrl(overview, deployment, "tokens"), urgent: false }];
    }),
    ...data.attention.nearLimitDeployments.flatMap(item => {
      const deployment = overview.deployments.find(record => record.id === item.deploymentId);
      if (!deployment) return [];
      const isFaceScan = item.capability === "FACE_SCAN";
      const identity = deploymentIdentity(overview, deployment);
      const subject = `${identity.client}’s ${identity.label} ${isFaceScan ? "face scans" : "assessments"}`;
      return [{ key: `${item.deploymentId}-${item.capability}`, count: item.used, badge: `${Math.round(item.used / item.limit * 100)}%`, title: `${subject} ${item.used >= item.limit ? "have reached" : "are nearing"} the monthly limit`,
        detail: `${item.used.toLocaleString()} of ${item.limit.toLocaleString()} used this month`, to: deploymentUrl(overview, deployment, "settings"), urgent: false }];
    }),
  ].filter(alert => alert.count > 0);
  const metrics: Array<{ label: string; key: keyof Counts }> = [
    { label: "Assessments scored", key: "assessments" },
    { label: "Face scans completed", key: "faceScans" },
    { label: "Recorded failures", key: "failedRequests" },
  ];
  return <div className="space-y-6">
    <section aria-labelledby="attention-title" className="space-y-3"><div className="flex items-baseline justify-between gap-3"><h2 id="attention-title" className="text-lg font-semibold">Needs attention</h2><span className="text-xs text-muted-foreground">Current checks</span></div>
      <Card><CardContent className="pt-6">{alerts.length === 0 ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-primary" aria-hidden="true" />No items need attention in these checks.</p>
        : <ul className="divide-y">{alerts.map(alert => <li key={alert.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span className={`flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 font-semibold tabular-nums ${alert.urgent ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground"}`}>{alert.badge}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{alert.title}</p><p className="text-xs text-muted-foreground">{alert.detail}</p></div>{alert.to && <Link to={alert.to} className="text-sm text-primary hover:underline">View <ArrowRight className="inline size-3" aria-hidden="true" /></Link>}</li>)}</ul>}
      </CardContent></Card>
    </section>
    <section aria-labelledby="month-title" className="space-y-3"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h2 id="month-title" className="shrink-0 text-lg font-semibold">This month</h2><span className="text-xs text-muted-foreground">{monthName(data.period.current)} to date · {monthName(data.period.previous)} total</span></div>
      <div className="grid gap-3 sm:grid-cols-3">{metrics.map(metric => <DashboardMetricCard key={metric.key} label={metric.label} metric={metric.key} current={data.activity.current[metric.key]} previous={data.activity.previous[metric.key]} monthly={data.monthlyUsage} previousMonth={monthName(data.period.previous)} />)}</div>
    </section>
    <div className="space-y-4"><Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading usage chart…</p>}><UsageChart monthly={data.monthlyUsage.map(item => ({ month: item.month, assessments: item.assessments, vitalIq: item.faceScans }))} /></Suspense>
      <DashboardClientUsage clients={data.clients} overview={overview} />
    </div>
    <RuleUsagePanel />
  </div>;
}
