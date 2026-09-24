import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Pencil, Plus } from "lucide-react";
import type { Overview } from "./Operations";
import { DeploymentDialog } from "./DeploymentDialog";
import { useClientUsage } from "./client-usage";
import { message, request } from "./api";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { RuleUsagePanel } from "./RuleUsagePanel";
import { deploymentVersion } from "./deployment-version";
import { hostingLabels } from "./Deployments";
import { DeleteRecord } from "./DeleteRecord";
import { paginate } from "./pagination";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import { deploymentUrl } from "./record-urls";
import { deploymentDisplayLabel } from "./deployment-label";
import type { DashboardClient } from "./DashboardClientUsage";

const UsageChart = lazy(() => import("./UsageChart").then(module => ({ default: module.UsageChart })));

type Allowance = DashboardClient["deployments"][number]["assessments"];
type Dashboard = {
  clients: DashboardClient[];
  attention: {
    expiringTokenDeployments: Array<{ deploymentId: string; count: number }>;
    nearLimitDeployments: Array<{ deploymentId: string; capability: "SCORING" | "FACE_SCAN"; used: number; limit: number }>;
  };
};

function AllowanceUsage({ label, usage }: { label: string; usage: Allowance }) {
  const description = !usage.available ? "Unavailable" : usage.limit === null
    ? `${usage.allowanceUsed.toLocaleString()} used · Unlimited`
    : `${usage.allowanceUsed.toLocaleString()} of ${usage.limit.toLocaleString()} used`;
  const percent = usage.limit && usage.limit > 0 ? Math.min(100, usage.allowanceUsed / usage.limit * 100) : 0;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{description}</span></div>
    {usage.available && usage.limit !== null && <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`${label} monthly allowance`} aria-valuenow={Math.min(usage.allowanceUsed, usage.limit)} aria-valuemin={0} aria-valuemax={usage.limit}><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>}
    {usage.available && usage.completed !== usage.allowanceUsed && <p className="text-xs text-muted-foreground">{usage.completed.toLocaleString()} completed</p>}
  </div>;
}

function AllowanceCell({ usage }: { usage?: Allowance }) {
  if (!usage) return <span className="text-muted-foreground">—</span>;
  if (!usage.available) return <span className="text-muted-foreground">Unavailable</span>;
  return <div className="space-y-0.5"><p className="tabular-nums">{usage.allowanceUsed.toLocaleString()} used · {usage.limit === null ? "Unlimited" : `${usage.limit.toLocaleString()} limit`}</p><p className="text-xs text-muted-foreground">{usage.completed.toLocaleString()} completed</p></div>;
}

export function ClientDetail({ data, clientId, refresh }: { data: Overview; clientId: string; refresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [selectedDeployment, setSelectedDeployment] = useState<Overview["deployments"][number] | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("overview");
  const [page, setPage] = useState(1);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardRetry, setDashboardRetry] = useState(0);
  const refreshDetails = async () => {
    await refresh();
    setDashboardRetry(value => value + 1);
  };
  useEffect(() => setPage(1), [clientId]);
  useEffect(() => {
    let current = true;
    setDashboard(null);
    setDashboardError("");
    void request<Dashboard>("/admin/dashboard").then(result => { if (current) setDashboard(result); }).catch(cause => { if (current) setDashboardError(message(cause)); });
    return () => { current = false; };
  }, [clientId, dashboardRetry]);
  const { usage, error, retry } = useClientUsage(clientId);
  const client = data.clients.find(item => item.id === clientId);
  if (!client) return <p>Client not found. <Link to="/clients" className="text-primary underline">Back to clients</Link></p>;
  const deployments = data.deployments.filter(item => item.clientId === clientId);
  const deploymentPage = paginate(deployments, page);
  const clientMetrics = dashboard?.clients.find(item => item.id === clientId);
  const lifetimeAssessments = usage?.reduce((total, item) => total + item.assessments, 0);
  const lifetimeFaceScans = usage?.reduce((total, item) => total + item.vitalIq, 0);
  const monthly = usage?.[0]?.monthly.map(({ month }) => ({ month, assessments: usage.reduce((sum, item) => sum + (item.monthly.find(entry => entry.month === month)?.assessments ?? 0), 0), vitalIq: usage.reduce((sum, item) => sum + (item.monthly.find(entry => entry.month === month)?.vitalIq ?? 0), 0) })) ?? (usage ? [] : null);
  const hasHistoricalActivity = monthly?.some(item => item.assessments > 0 || item.vitalIq > 0);
  const hasAllTimeActivity = Boolean(usage?.some(item => item.assessments > 0 || item.vitalIq > 0));
  const alerts = [
    ...(dashboard?.attention.expiringTokenDeployments ?? []).flatMap(item => {
      const deployment = deployments.find(record => record.id === item.deploymentId);
      if (!deployment) return [];
      const label = deploymentDisplayLabel(deployment, data.deployments);
      return [{ key: `token-${deployment.id}`, title: `${label}: unused activation ${item.count === 1 ? "token expires" : "tokens expire"} soon`, detail: `${item.count} within 7 days`, to: deploymentUrl(data, deployment, "tokens") }];
    }),
    ...(dashboard?.attention.nearLimitDeployments ?? []).flatMap(item => {
      const deployment = deployments.find(record => record.id === item.deploymentId);
      if (!deployment) return [];
      const label = deploymentDisplayLabel(deployment, data.deployments);
      const capability = item.capability === "FACE_SCAN" ? "face scans" : "assessments";
      return [{ key: `limit-${deployment.id}-${item.capability}`, title: `${label}: ${capability} ${item.used >= item.limit ? "have reached" : "are nearing"} the monthly limit`, detail: `${item.used.toLocaleString()} of ${item.limit.toLocaleString()} used this month`, to: deploymentUrl(data, deployment, "settings") }];
    }),
  ];
  return <section className="min-w-0 space-y-4">
    <header className="space-y-2"><nav aria-label="Breadcrumb" className="text-sm"><Link to="/clients" className="text-primary hover:underline">Clients</Link><span className="mx-2 text-muted-foreground">/</span><span className="text-muted-foreground">{client.name}</span></nav><div className="flex items-center justify-between gap-4"><div className="flex min-w-0 flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{client.name}</h1><Badge variant={client.enabled ? "default" : "secondary"}>{client.enabled ? "Enabled" : "Disabled"}</Badge></div>{activeTab === "deployments" && <Button size="icon" aria-label="Create deployment" title="Create deployment" className="shrink-0" onClick={() => setSelectedDeployment(null)}><Plus className="size-4" aria-hidden="true" /></Button>}</div></header>
    <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4"><TabsList variant="line" aria-label="Client details" className="h-auto min-h-11 w-full justify-start gap-6 rounded-none border-b p-0"><TabsTrigger value="overview" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Overview</TabsTrigger><TabsTrigger value="deployments" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Deployments <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{deployments.length}</Badge></TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-5">
        {dashboardError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load current usage and limits. {dashboardError}<Button variant="outline" size="sm" onClick={() => setDashboardRetry(value => value + 1)}>Retry</Button></div>}
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load usage history. {error}<Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          {([{ label: "Assessments scored", value: clientMetrics?.assessments, lifetime: lifetimeAssessments }, { label: "Face scans completed", value: clientMetrics?.faceScans, lifetime: lifetimeFaceScans }]).map(({ label, value, lifetime }) => <Card key={label}><CardContent className="space-y-2 pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="text-3xl font-semibold tabular-nums">{value === undefined ? "—" : value.toLocaleString()}</p><p className="text-xs text-muted-foreground">This month · completed</p><p className="border-t pt-3 text-sm text-muted-foreground">Lifetime: <span className="font-medium tabular-nums text-foreground">{lifetime === undefined ? "—" : lifetime.toLocaleString()}</span></p></CardContent></Card>)}
        </div>
        {alerts.length > 0 && <Card><CardHeader><CardTitle>Needs attention</CardTitle></CardHeader><CardContent><ul className="divide-y">{alerts.map(alert => <li key={alert.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{alert.title}</p><p className="text-xs text-muted-foreground">{alert.detail}</p></div><Link to={alert.to} className="shrink-0 text-sm text-primary hover:underline">View <ArrowRight className="inline size-3" aria-hidden="true" /></Link></li>)}</ul></CardContent></Card>}
        <Card><CardHeader className="flex-row items-center justify-between gap-3"><CardTitle>Monthly allowances by deployment</CardTitle><span className="text-xs text-muted-foreground">This month</span></CardHeader><CardContent>
          {!dashboard && !dashboardError ? <p role="status" className="text-sm text-muted-foreground">Loading allowances…</p> : clientMetrics?.deployments.length ? <div className="grid gap-3 lg:grid-cols-2">{clientMetrics.deployments.map(item => {
            const deployment = deployments.find(record => record.id === item.id);
            if (!deployment) return null;
            const label = deploymentDisplayLabel(deployment, data.deployments);
            return <div key={item.id} className="space-y-4 rounded-lg border p-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><Link to={deploymentUrl(data, deployment)} className="font-semibold hover:text-primary hover:underline">{label}</Link><span className="text-xs capitalize text-muted-foreground">{deployment.environment}</span></div><AllowanceUsage label="Assessments" usage={item.assessments} /><AllowanceUsage label="Face scans" usage={item.faceScans} /></div>;
          })}</div> : <p className="text-sm text-muted-foreground">No deployments or allowances are available.</p>}
          <p className="mt-4 text-xs text-muted-foreground">Allowance use can exceed completed scans while a scan is in progress.</p>
        </CardContent></Card>
        {!error && (monthly && !hasHistoricalActivity ? <Card><CardHeader className="flex-row items-center justify-between gap-3"><CardTitle>Usage over time</CardTitle><span className="text-xs text-muted-foreground">Last 6 months</span></CardHeader><CardContent><p className="py-12 text-center text-sm text-muted-foreground">{hasAllTimeActivity ? "No activity in the last 6 months." : "No activity recorded yet."}</p></CardContent></Card> : <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading chart…</p>}><UsageChart monthly={monthly} /></Suspense>)}
        <RuleUsagePanel clientId={clientId} />
      </TabsContent>
      <TabsContent value="deployments" className="space-y-5">{dashboardError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load current usage and limits. {dashboardError}<Button variant="outline" size="sm" onClick={() => setDashboardRetry(value => value + 1)}>Retry</Button></div>}<Card><CardContent className="pt-6"><div className="max-w-full overflow-x-auto"><Table className="min-w-[850px]"><TableHeader><TableRow><TableHead>Deployment</TableHead><TableHead>Status</TableHead><TableHead>Rule</TableHead><TableHead>Assessments · this month</TableHead><TableHead>Face scans · this month</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{deploymentPage.rows.map(item => { const counts = clientMetrics?.deployments.find(entry => entry.id === item.id); const label = deploymentDisplayLabel(item, data.deployments); return <TableRow key={item.id}><TableCell><Link to={deploymentUrl(data, item)} className="font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{label}</Link><span className="block text-xs capitalize text-muted-foreground">{item.environment} · {item.hostingType ? hostingLabels[item.hostingType] : "Hosting not specified"}</span></TableCell><TableCell><Badge variant={item.enabled ? "default" : "secondary"}>{item.enabled ? "Enabled" : "Disabled"}</Badge></TableCell><TableCell>{deploymentVersion(data, item.id).label}</TableCell><TableCell><AllowanceCell usage={counts?.assessments} /></TableCell><TableCell><AllowanceCell usage={counts?.faceScans} /></TableCell><TableCell className="text-right"><div className="ml-auto grid w-[4.75rem] grid-cols-2 gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${label} deployment`} title="Edit deployment" onClick={() => setSelectedDeployment(item)}><Pencil className="size-4" /></Button><DeleteRecord iconOnly kind="deployments" id={item.id} name={`${client.name} ${label} deployment`} refresh={refreshDetails} revision={data} /></div></TableCell></TableRow>; })}{deployments.length === 0 && <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No deployments yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
        <Pagination aria-label="Client deployments pagination"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={deploymentPage.page === 1} onClick={() => setPage(deploymentPage.page - 1)}>Previous</Button></PaginationItem><PaginationItem><span className="flex flex-col items-center gap-1 px-2 text-xs text-muted-foreground sm:block sm:px-3 sm:text-sm" role="status"><span className="whitespace-nowrap">Page {deploymentPage.page} of {deploymentPage.pageCount}</span><span className="whitespace-nowrap"><span className="hidden sm:inline"> · </span>{deploymentPage.total} total</span></span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={deploymentPage.page === deploymentPage.pageCount} onClick={() => setPage(deploymentPage.page + 1)}>Next</Button></PaginationItem></PaginationContent></Pagination>
      </TabsContent>
    </Tabs>
    {selectedDeployment !== undefined && <DeploymentDialog data={data} deployment={selectedDeployment} initialClientId={clientId} refresh={refreshDetails} onClose={() => setSelectedDeployment(undefined)} onCreated={id => { setSelectedDeployment(undefined); navigate(`/deployments/${id}?tab=tokens`); }} />}
  </section>;
}
