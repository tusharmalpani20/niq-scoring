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
import { hostingLabels } from "./Deployments";
import { DeleteRecord } from "./DeleteRecord";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import { clientUrl, deploymentUrl } from "./record-urls";
import type { DashboardClient } from "./DashboardClientUsage";
import { ListSkeleton } from "./ListSkeleton";
import { Skeleton } from "./components/ui/skeleton";

const UsageChart = lazy(() => import("./UsageChart").then(module => ({ default: module.UsageChart })));

function ClientDetailSkeleton() {
  return <section role="status" aria-label="Loading client details" className="space-y-5">
    <Skeleton className="h-4 w-36" />
    <div className="flex items-center gap-3"><Skeleton className="h-9 w-44" /><Skeleton className="h-6 w-20 rounded-full" /></div>
    <div className="flex gap-6 border-b pb-3"><Skeleton className="h-5 w-20" /><Skeleton className="h-5 w-28" /></div>
    <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map(item => <Card key={item}><CardContent className="space-y-4 pt-6"><Skeleton className="h-4 w-36" /><Skeleton className="h-9 w-20" /><Skeleton className="h-4 w-44" /><Skeleton className="h-4 w-28" /></CardContent></Card>)}</div>
    <Card><CardHeader><Skeleton className="h-5 w-60" /></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{[0, 1].map(item => <div key={item} className="space-y-4 rounded-lg border p-4"><Skeleton className="h-5 w-36" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /></div>)}</CardContent></Card>
  </section>;
}

type Allowance = DashboardClient["deployments"][number]["assessments"];
type Dashboard = {
  clients: DashboardClient[];
  attention: {
    expiringTokenDeployments: Array<{ deploymentId: string; count: number }>;
    nearLimitDeployments: Array<{ deploymentId: string; capability: "SCORING" | "FACE_SCAN"; used: number; limit: number }>;
  };
};
type ClientRecord = Overview["clients"][number] & { deploymentCount: number };
type DeploymentRow = Overview["deployments"][number] & { displayLabel: string; ruleLabel: string; assignment: Overview["assignments"][number] | null; entitlements: Overview["entitlements"] };
type DeploymentPage = { items: DeploymentRow[]; total: number; page: number; pageSize: number; pageCount: number };

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

function AllowanceCell({ usage }: { usage: Allowance | undefined }) {
  if (!usage) return <span className="text-muted-foreground">—</span>;
  if (!usage.available) return <span className="text-muted-foreground">Unavailable</span>;
  return <div className="space-y-0.5"><p className="tabular-nums">{usage.allowanceUsed.toLocaleString()} used · {usage.limit === null ? "Unlimited" : `${usage.limit.toLocaleString()} limit`}</p><p className="text-xs text-muted-foreground">{usage.completed.toLocaleString()} completed</p></div>;
}

export function ClientDetail({ clientId }: { clientId: string }) {
  const navigate = useNavigate();
  const [selectedDeployment, setSelectedDeployment] = useState<Overview["deployments"][number] | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("overview");
  const [page, setPage] = useState(1);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardRetry, setDashboardRetry] = useState(0);
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [clientError, setClientError] = useState("");
  const [clientRetry, setClientRetry] = useState(0);
  const [deploymentPage, setDeploymentPage] = useState<DeploymentPage | null>(null);
  const [deploymentError, setDeploymentError] = useState("");
  const [deploymentLoading, setDeploymentLoading] = useState(true);
  const [deploymentRetry, setDeploymentRetry] = useState(0);
  const [dialogData, setDialogData] = useState<Overview | null>(null);
  const [dialogError, setDialogError] = useState("");
  const refreshDetails = async () => {
    setDeploymentRetry(value => value + 1);
    setClientRetry(value => value + 1);
    setDashboardRetry(value => value + 1);
  };
  useEffect(() => setPage(1), [clientId]);
  useEffect(() => {
    let current = true;
    setClient(null); setClientError("");
    void request<{ client: ClientRecord }>(`/admin/clients/${encodeURIComponent(clientId)}`).then(result => { if (current) setClient(result.client); }).catch(cause => { if (current) setClientError(message(cause)); });
    return () => { current = false; };
  }, [clientId, clientRetry]);
  useEffect(() => {
    if (!client) return;
    let current = true;
    setDeploymentLoading(true); setDeploymentError("");
    void request<DeploymentPage>(`/admin/deployments?clientId=${encodeURIComponent(client.id)}&page=${page}&pageSize=10`).then(result => {
      if (current) { setDeploymentPage(result); if (result.page !== page) setPage(result.page); }
    }).catch(cause => { if (current) setDeploymentError(message(cause)); }).finally(() => { if (current) setDeploymentLoading(false); });
    return () => { current = false; };
  }, [client?.id, page, deploymentRetry]);
  useEffect(() => {
    if (selectedDeployment === undefined) { setDialogData(null); setDialogError(""); return; }
    let current = true;
    void request<Overview>("/admin/overview").then(result => { if (current) setDialogData(result); }).catch(cause => { if (current) setDialogError(message(cause)); });
    return () => { current = false; };
  }, [selectedDeployment]);
  useEffect(() => {
    if (!client) return;
    let current = true;
    setDashboard(null);
    setDashboardError("");
    void request<Dashboard>(`/admin/dashboard/clients/${encodeURIComponent(client.id)}`).then(result => { if (current) setDashboard(result); }).catch(cause => { if (current) setDashboardError(message(cause)); });
    return () => { current = false; };
  }, [client?.id, dashboardRetry]);
  const { usage, error, retry } = useClientUsage(client?.id ?? "");
  if (!client) return clientError ? <div role="alert">{clientError} <Button variant="outline" onClick={() => setClientRetry(value => value + 1)}>Try again</Button> <Link to="/clients" className="text-primary underline">Back to clients</Link></div> : <ClientDetailSkeleton />;
  const deployments = deploymentPage?.items ?? [];
  const data: Overview = { clients: [client], deployments, entitlements: deployments.flatMap(item => item.entitlements), assignments: deployments.flatMap(item => item.assignment ? [item.assignment] : []), versions: [] };
  const clientMetrics = dashboard?.clients.find(item => item.id === client.id);
  const lifetimeAssessments = usage?.reduce((total, item) => total + item.assessments, 0);
  const lifetimeFaceScans = usage?.reduce((total, item) => total + item.vitalIq, 0);
  const monthly = usage?.[0]?.monthly.map(({ month }) => ({ month, assessments: usage.reduce((sum, item) => sum + (item.monthly.find(entry => entry.month === month)?.assessments ?? 0), 0), vitalIq: usage.reduce((sum, item) => sum + (item.monthly.find(entry => entry.month === month)?.vitalIq ?? 0), 0) })) ?? (usage ? [] : null);
  const hasHistoricalActivity = monthly?.some(item => item.assessments > 0 || item.vitalIq > 0);
  const hasAllTimeActivity = Boolean(usage?.some(item => item.assessments > 0 || item.vitalIq > 0));
  const alerts = [
    ...(dashboard?.attention.expiringTokenDeployments ?? []).flatMap(item => {
      const deployment = deployments.find(record => record.id === item.deploymentId);
      const label = deployment?.displayLabel ?? clientMetrics?.deployments.find(record => record.id === item.deploymentId)?.name;
      if (!label) return [];
      return [{ key: `token-${item.deploymentId}`, title: `${label}: unused activation ${item.count === 1 ? "token expires" : "tokens expire"} soon`, detail: `${item.count} within 7 days`, to: deployment ? deploymentUrl(data, deployment, "tokens") : `/deployments/${clientUrl(client).slice("/clients/".length)}/${item.deploymentId}/tokens` }];
    }),
    ...(dashboard?.attention.nearLimitDeployments ?? []).flatMap(item => {
      const deployment = deployments.find(record => record.id === item.deploymentId);
      const label = deployment?.displayLabel ?? clientMetrics?.deployments.find(record => record.id === item.deploymentId)?.name;
      if (!label) return [];
      const capability = item.capability === "FACE_SCAN" ? "Vital IQ scans" : "assessments";
      return [{ key: `limit-${item.deploymentId}-${item.capability}`, title: `${label}: ${capability} ${item.used >= item.limit ? "have reached" : "are nearing"} the monthly limit`, detail: `${item.used.toLocaleString()} of ${item.limit.toLocaleString()} used this month`, to: deployment ? deploymentUrl(data, deployment, "settings") : `/deployments/${clientUrl(client).slice("/clients/".length)}/${item.deploymentId}/settings` }];
    }),
  ];
  return <section className="min-w-0 space-y-4">
    <header className="space-y-2"><nav aria-label="Breadcrumb" className="text-sm"><Link to="/clients" className="text-primary hover:underline">Clients</Link><span className="mx-2 text-muted-foreground">/</span><span className="text-muted-foreground">{client.name}</span></nav><div className="flex items-center justify-between gap-4"><div className="flex min-w-0 flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{client.name}</h1><Badge variant={client.enabled ? "success" : "inactive"}>{client.enabled ? "Enabled" : "Disabled"}</Badge></div>{activeTab === "deployments" && <Button size="icon" aria-label="Create deployment" title="Create deployment" className="shrink-0" onClick={() => setSelectedDeployment(null)}><Plus className="size-4" aria-hidden="true" /></Button>}</div></header>
    <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4"><TabsList variant="line" aria-label="Client details" className="h-auto min-h-11 w-full justify-start gap-6 rounded-none border-b p-0"><TabsTrigger value="overview" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Overview</TabsTrigger><TabsTrigger value="deployments" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Deployments <span className="tab-count tabular-nums">{client.deploymentCount}</span></TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-5">
        {dashboardError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load current usage and limits. {dashboardError}<Button variant="outline" size="sm" onClick={() => setDashboardRetry(value => value + 1)}>Retry</Button></div>}
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load usage history. {error}<Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          {([{ label: "Assessments scored", value: clientMetrics?.assessments, lifetime: lifetimeAssessments }, { label: "Vital IQ scans completed", value: clientMetrics?.faceScans, lifetime: lifetimeFaceScans }]).map(({ label, value, lifetime }) => <Card key={label}><CardContent className="space-y-2 pt-6"><p className="text-sm text-muted-foreground">{label}</p>{!dashboard && !dashboardError ? <Skeleton className="h-9 w-20" /> : <p className="text-3xl font-semibold tabular-nums">{value === undefined ? "—" : value.toLocaleString()}</p>}<p className="text-xs text-muted-foreground">This month · completed</p><p className="border-t pt-3 text-sm text-muted-foreground">Lifetime: {usage === null && !error ? <Skeleton className="inline-block h-4 w-14 align-middle" /> : <span className="font-medium tabular-nums text-foreground">{lifetime === undefined ? "—" : lifetime.toLocaleString()}</span>}</p></CardContent></Card>)}
        </div>
        {alerts.length > 0 && <Card><CardHeader><CardTitle>Needs attention</CardTitle></CardHeader><CardContent><ul className="divide-y">{alerts.map(alert => <li key={alert.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{alert.title}</p><p className="text-xs text-muted-foreground">{alert.detail}</p></div><Link to={alert.to} className="shrink-0 text-sm text-primary hover:underline">View <ArrowRight className="inline size-3" aria-hidden="true" /></Link></li>)}</ul></CardContent></Card>}
        <Card><CardHeader className="flex-row items-center justify-between gap-3"><CardTitle>Monthly allowances by deployment</CardTitle><span className="text-xs text-muted-foreground">This month</span></CardHeader><CardContent>
          {!dashboard && !dashboardError ? <div role="status" aria-label="Loading allowances" className="grid gap-3 lg:grid-cols-2">{[0, 1].map(item => <div key={item} className="space-y-4 rounded-lg border p-4"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-3/4" /></div>)}</div> : clientMetrics?.deployments.length ? <div className="grid gap-3 lg:grid-cols-2">{clientMetrics.deployments.map(item => {
            const deployment = deployments.find(record => record.id === item.id);
            const label = deployment?.displayLabel ?? item.name;
            return <div key={item.id} className="space-y-4 rounded-lg border p-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><Link to={deployment ? deploymentUrl(data, deployment) : `/deployments/${clientUrl(client).slice("/clients/".length)}/${item.id}`} className="font-semibold text-primary hover:underline">{label}</Link>{deployment && <span className="text-xs capitalize text-muted-foreground">{deployment.environment}</span>}</div><AllowanceUsage label="Assessments" usage={item.assessments} /><AllowanceUsage label="Vital IQ scans" usage={item.faceScans} /></div>;
          })}</div> : <p className="text-sm text-muted-foreground">No deployments or allowances are available.</p>}
          <p className="mt-4 text-xs text-muted-foreground">Allowance use can exceed completed scans while a scan is in progress.</p>
        </CardContent></Card>
        {!error && (monthly && !hasHistoricalActivity ? <Card><CardHeader className="flex-row items-center justify-between gap-3"><CardTitle>Usage over time</CardTitle><span className="text-xs text-muted-foreground">Last 6 months</span></CardHeader><CardContent><p className="py-12 text-center text-sm text-muted-foreground">{hasAllTimeActivity ? "No activity in the last 6 months." : "No activity recorded yet."}</p></CardContent></Card> : <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading chart…</p>}><UsageChart monthly={monthly} /></Suspense>)}
        <RuleUsagePanel clientId={client.id} />
      </TabsContent>
      <TabsContent value="deployments" className="space-y-5">
        {dashboardError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load current usage and limits. {dashboardError}<Button variant="outline" size="sm" onClick={() => setDashboardRetry(value => value + 1)}>Retry</Button></div>}
        {deploymentLoading ? <ListSkeleton label="client deployments" columns={6} /> : deploymentError ? <div role="alert" className="space-y-3"><p>{deploymentError}</p><Button variant="outline" onClick={() => setDeploymentRetry(value => value + 1)}>Try again</Button></div> : <Card className={deploymentPage?.total ? "mobile-list-card" : undefined}><CardContent className="pt-6">
          <Table className={deploymentPage?.total ? "mobile-record-table client-deployment-record-table" : undefined}>
            <TableHeader><TableRow><TableHead>Deployment</TableHead><TableHead>Status</TableHead><TableHead>Rule</TableHead><TableHead>Assessments · this month</TableHead><TableHead>Vital IQ scans · this month</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{deployments.map(item => { const counts = clientMetrics?.deployments.find(entry => entry.id === item.id); const label = item.displayLabel; return <TableRow key={item.id}>
              <TableCell data-label="Deployment"><Link to={deploymentUrl(data, item)} className="font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{label}</Link><span className="block text-xs capitalize text-muted-foreground">{item.environment} · {item.hostingType ? hostingLabels[item.hostingType] : "Hosting not specified"}</span></TableCell>
              <TableCell data-label="Status"><Badge variant={item.enabled ? "success" : "inactive"}>{item.enabled ? "Enabled" : "Disabled"}</Badge></TableCell>
              <TableCell data-label="Rule">{item.ruleLabel}</TableCell>
              <TableCell data-label="Assessments"><AllowanceCell usage={counts?.assessments} /></TableCell>
              <TableCell data-label="Vital IQ scans"><AllowanceCell usage={counts?.faceScans} /></TableCell>
              <TableCell data-label="Actions" className="text-right"><div className="flex items-center justify-end gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${label} deployment`} title="Edit deployment" onClick={() => setSelectedDeployment(item)}><Pencil className="size-4" /></Button><DeleteRecord iconOnly kind="deployments" id={item.id} name={`${client.name} ${label} deployment`} refresh={refreshDetails} revision={deploymentRetry} /></div></TableCell>
            </TableRow>; })}</TableBody>
          </Table>
          {deploymentPage?.total === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No deployments yet.</p>}
        </CardContent></Card>}
        {!!deploymentPage?.total && !deploymentError && <Pagination aria-label="Client deployments pagination"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={deploymentLoading || deploymentPage.page === 1} onClick={() => setPage(deploymentPage.page - 1)}>Previous</Button></PaginationItem><PaginationItem><span className="whitespace-nowrap px-2 text-xs text-muted-foreground sm:px-3 sm:text-sm" role="status">Page {deploymentPage.page} of {deploymentPage.pageCount}</span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={deploymentLoading || deploymentPage.page === deploymentPage.pageCount} onClick={() => setPage(deploymentPage.page + 1)}>Next</Button></PaginationItem></PaginationContent></Pagination>}
      </TabsContent>
    </Tabs>
    {selectedDeployment !== undefined && !dialogData && !dialogError && <div role="status" className="text-sm text-muted-foreground">Loading deployment form…</div>}
    {selectedDeployment !== undefined && dialogError && <div role="alert" className="text-sm text-destructive">{dialogError} <Button variant="outline" size="sm" onClick={() => setSelectedDeployment(undefined)}>Close</Button></div>}
    {selectedDeployment !== undefined && dialogData && <DeploymentDialog data={dialogData} deployment={selectedDeployment} initialClientId={client.id} refresh={refreshDetails} onClose={() => setSelectedDeployment(undefined)} onCreated={id => { setSelectedDeployment(undefined); navigate(`/deployments/${id}?tab=tokens`); }} />}
  </section>;
}
