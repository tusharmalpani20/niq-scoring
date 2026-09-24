import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { message, request } from "./api";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { clientUrl, deploymentUrl } from "./record-urls";
import type { Overview } from "./Operations";
import { RuleUsagePanel } from "./RuleUsagePanel";
import { DashboardClientUsage, type DashboardClient } from "./DashboardClientUsage";

const UsageChart = lazy(() => import("./UsageChart").then(module => ({ default: module.UsageChart })));

type Counts = { assessments: number; faceScans: number; failedRequests: number };
type Dashboard = {
  period: { current: string; previous: string; asOf: string };
  activity: { current: Counts; previous: Counts };
  monthlyUsage: Array<{ month: string } & Counts>;
  clients: DashboardClient[];
  attention: { failedScoring24h: number; disabledDeployments: number; expiringActivationTokens: number; nearLimitDeployments: Array<{ deploymentId: string; capability: "SCORING" | "FACE_SCAN"; used: number; limit: number }> };
  recentActivity: Array<{ id: string; action: string; resourceType: string; resourceReference: string | null; clientId: string | null; deploymentId: string | null; occurredAt: string }>;
};

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const change = (current: number, previous: number) => `${current >= previous ? "+" : "−"}${Math.abs(current - previous).toLocaleString()} vs last month total`;

function RecentActivity({ data, overview }: { data: Dashboard["recentActivity"]; overview: Overview }) {
  const labels: Record<string, string> = {
    RULE_CREATED: "Rule created", RULE_SAVED: "Rule updated", RULE_VALIDATED: "Rule validated",
    RULE_APPROVED: "Rule approved", RULE_ACTIVE: "Rule activated", RULE_RETIRED: "Rule retired",
    RULE_DELETED: "Draft rule deleted", ADMIN_INVITED: "Administrator invited",
    ADMIN_INVITATION_REVOKED: "Invitation revoked", ADMIN_ENABLED: "Administrator enabled",
    ADMIN_DISABLED: "Administrator disabled",
  };
  const label = (action: string) => labels[action] ?? action.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
  return <Card><CardHeader><CardTitle>Recent rule and access changes</CardTitle></CardHeader><CardContent>
    {data.length === 0 ? <p className="text-sm text-muted-foreground">No recent administration changes.</p> : <ul className="divide-y">
      {data.map(event => {
        const deployment = overview.deployments.find(item => item.id === event.deploymentId);
        const client = overview.clients.find(item => item.id === event.clientId);
        const rule = event.resourceType === "rule_version" ? overview.versions.find(item => item.id === event.resourceReference) : undefined;
        const destination = deployment ? deploymentUrl(overview, deployment) : client ? clientUrl(client) : rule ? `/versions/${rule.id}` : event.resourceType === "ADMIN_USER" ? "/users" : null;
        return <li key={event.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0 text-sm">{destination ? <Link className="font-medium text-primary hover:underline" to={destination}>{label(event.action)}</Link> : <span className="font-medium">{label(event.action)}</span>}
            {(client || deployment || rule) && <p className="text-xs text-muted-foreground">{client?.name}{client && deployment ? " · " : ""}{deployment?.name ?? rule?.version}</p>}</div>
          <time className="shrink-0 text-xs text-muted-foreground" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleDateString()}</time>
        </li>;
      })}
    </ul>}
  </CardContent></Card>;
}

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
    { key: "expiring-tokens", count: data.attention.expiringActivationTokens, badge: String(data.attention.expiringActivationTokens), title: "Activation tokens expiring", detail: "Unused tokens within 7 days", to: "/deployments", urgent: false },
    ...data.attention.nearLimitDeployments.map(item => {
      const deployment = overview.deployments.find(record => record.id === item.deploymentId);
      return { key: `${item.deploymentId}-${item.capability}`, count: item.used, badge: `${Math.round(item.used / item.limit * 100)}%`, title: `${deployment?.name ?? "Deployment"} nearing ${item.capability === "SCORING" ? "assessment" : "face scan"} limit`,
        detail: `${item.used.toLocaleString()} of ${item.limit.toLocaleString()} used this month`, to: deployment ? deploymentUrl(overview, deployment, "settings") : "/deployments", urgent: false };
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
      <div className="grid gap-3 sm:grid-cols-3">{metrics.map(metric => <Card key={metric.key}><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{metric.label}</p><strong className="mt-2 block text-3xl font-semibold tabular-nums">{data.activity.current[metric.key].toLocaleString()}</strong><p className="mt-1 text-xs text-muted-foreground">{change(data.activity.current[metric.key], data.activity.previous[metric.key])}</p></CardContent></Card>)}</div>
    </section>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]"><Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading usage chart…</p>}><UsageChart monthly={data.monthlyUsage.map(item => ({ month: item.month, assessments: item.assessments, vitalIq: item.faceScans }))} /></Suspense>
      <DashboardClientUsage clients={data.clients} overview={overview} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Manage</CardTitle></CardHeader><CardContent><ul className="divide-y">{[["Clients", overview.clients.length, "/clients"], ["Deployments", overview.deployments.length, "/deployments"], ["Rules", overview.versions.length, "/versions"]].map(([label, count, to]) => <li key={label} className="py-2 first:pt-0 last:pb-0"><Link to={String(to)} className="flex justify-between text-sm hover:text-primary"><span>{label}</span><span className="text-primary tabular-nums">{count} →</span></Link></li>)}</ul></CardContent></Card><RecentActivity data={data.recentActivity} overview={overview} /></div>
    <RuleUsagePanel />
  </div>;
}
