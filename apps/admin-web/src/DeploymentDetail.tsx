import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import { message, request } from "./api";
import type { Overview } from "./Operations";
import { deploymentVersion } from "./deployment-version";
import { hostingLabels } from "./Deployments";
import { useClientUsage } from "./client-usage";
import { ActivationTokenPanel } from "./ActivationTokenPanel";
import { DeploymentDialog } from "./DeploymentDialog";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { clientUrl, deploymentUrl } from "./record-urls";
import { deploymentDisplayLabel } from "./deployment-label";

const UsageChart = lazy(() => import("./UsageChart").then(module => ({ default: module.UsageChart })));

type MonthlyAllowance = { completed: number; allowanceUsed: number; limit: number | null; available: boolean };
type DashboardDeployment = { id: string; assessments: MonthlyAllowance; faceScans: MonthlyAllowance };
type DashboardClient = { id: string; deployments: DashboardDeployment[] };

function AllowanceRow({ label, usage }: { label: string; usage: MonthlyAllowance }) {
  const limit = usage.limit;
  const percent = limit !== null && limit > 0 ? Math.min(100, usage.allowanceUsed / limit * 100) : 0;
  return <div className="space-y-2 py-3 first:pt-0 last:pb-0">
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-medium">{label}</span><span className="tabular-nums">{usage.available ? limit === null ? `${usage.allowanceUsed.toLocaleString()} used · Unlimited` : `${usage.allowanceUsed.toLocaleString()} of ${limit.toLocaleString()} used` : "Disabled"}</span></div>
    {usage.available && limit !== null && <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`${label} monthly allowance`} aria-valuenow={Math.min(usage.allowanceUsed, limit)} aria-valuemin={0} aria-valuemax={limit}><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>}
    <p className="text-xs text-muted-foreground tabular-nums">{usage.completed.toLocaleString()} completed this month{usage.allowanceUsed !== usage.completed ? " · Pending requests may also use allowance" : ""}</p>
  </div>;
}

export function DeploymentDetail({ data, deploymentId, refresh }: { data: Overview; deploymentId: string; refresh: () => Promise<void> }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [tokenCreating, setTokenCreating] = useState(false);
  const [dashboardClients, setDashboardClients] = useState<DashboardClient[] | null>(null);
  const [allowanceError, setAllowanceError] = useState("");
  const [allowanceAttempt, setAllowanceAttempt] = useState(0);
  const refreshDetails = async () => {
    await refresh();
    setAllowanceAttempt(value => value + 1);
  };
  const deployment = data.deployments.find(item => item.id === deploymentId);
  const client = data.clients.find(item => item.id === deployment?.clientId);
  const { usage, error, retry } = useClientUsage(deployment?.clientId ?? "");
  useEffect(() => {
    let active = true;
    setDashboardClients(null);
    setAllowanceError("");
    void request<{ clients: DashboardClient[] }>("/admin/dashboard").then(result => {
      if (active) setDashboardClients(result.clients);
    }).catch(cause => { if (active) setAllowanceError(message(cause)); });
    return () => { active = false; };
  }, [deploymentId, allowanceAttempt]);
  if (!deployment || !client) return <p>Deployment not found. <Link to="/deployments" className="text-primary underline">Back to deployments</Link></p>;
  const metrics = usage?.find(item => item.deploymentId === deploymentId);
  const monthlyAllowance = dashboardClients?.find(item => item.id === client.id)?.deployments.find(item => item.id === deploymentId);
  const hasActivity = Boolean(metrics && (metrics.assessments > 0 || metrics.vitalIq > 0));
  const hasRecentActivity = Boolean(metrics?.monthly.some(month => month.assessments > 0 || month.vitalIq > 0));
  const entitlement = (capability: "SCORING" | "FACE_SCAN") => {
    const item = data.entitlements.find(entry => entry.deploymentId === deployment.id && entry.capability === capability);
    return !item?.enabled ? "Disabled" : item.monthlyLimit === null ? "Unlimited" : `${item.monthlyLimit.toLocaleString()} per month`;
  };
  const tab = location.pathname.endsWith("/settings") ? "settings" : location.pathname.endsWith("/tokens") ? "tokens" : "overview";
  const changeTab = (value: string) => {
    if (value !== "tokens") setTokenCreating(false);
    if (value === "overview" || value === "settings" || value === "tokens") navigate(deploymentUrl(data, deployment, value), { replace: true });
  };
  const environment = deployment.environment.charAt(0).toUpperCase() + deployment.environment.slice(1);
  const label = deploymentDisplayLabel(deployment, data.deployments);
  return <section className="min-w-0 space-y-4">
    <header className="space-y-2"><nav aria-label="Breadcrumb" className="text-sm"><Link to="/clients" className="text-primary hover:underline">Clients</Link><span className="mx-2 text-muted-foreground">/</span><Link to={clientUrl(client)} className="text-primary hover:underline">{client.name}</Link><span className="mx-2 text-muted-foreground">/</span><span className="text-muted-foreground">{label}</span></nav><div className="flex items-center justify-between gap-4"><div className="flex min-w-0 flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{label}</h1><Badge variant={deployment.enabled ? "default" : "secondary"}>{deployment.enabled ? "Enabled" : "Disabled"}</Badge></div>{tab === "settings" && <Button size="icon" aria-label="Edit deployment" title="Edit deployment" className="shrink-0" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden="true" /></Button>}{tab === "tokens" && <Button size="icon" aria-label="Create token" title="Create token" className="shrink-0" onClick={() => setTokenCreating(value => !value)}><Plus className="size-4" aria-hidden="true" /></Button>}</div><p className="text-sm text-muted-foreground">{client.name} · {environment} environment · {deployment.hostingType ? hostingLabels[deployment.hostingType] : "Hosting not specified"} · {deploymentVersion(data, deployment.id).label}</p></header>
    <Tabs value={tab} onValueChange={changeTab} className="gap-4"><TabsList variant="line" aria-label="Deployment details" className="h-auto min-h-11 w-full justify-start gap-6 rounded-none border-b p-0"><TabsTrigger value="overview" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Overview</TabsTrigger><TabsTrigger value="settings" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Settings &amp; limits</TabsTrigger><TabsTrigger value="tokens" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Tokens</TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-5">
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load usage. {error}<Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>}
        <Card><CardContent className="grid gap-6 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-8">
          <div className="space-y-5"><h2 className="font-semibold">Lifetime usage</h2><div className="grid grid-cols-2 gap-4"><div><p className="text-sm text-muted-foreground">Assessments scored</p><p className="mt-1 text-3xl font-semibold tabular-nums">{metrics ? metrics.assessments.toLocaleString() : "—"}</p></div><div><p className="text-sm text-muted-foreground">Face scans completed</p><p className="mt-1 text-3xl font-semibold tabular-nums">{metrics ? metrics.vitalIq.toLocaleString() : "—"}</p></div></div></div>
          <div className="space-y-4 border-t pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"><div><h2 className="font-semibold">This month’s allowances</h2><p className="mt-1 text-xs text-muted-foreground">Allowance use can include pending requests.</p></div>{allowanceError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">Could not load allowances. {allowanceError}<Button variant="outline" size="sm" onClick={() => setAllowanceAttempt(value => value + 1)}>Retry</Button></div> : !dashboardClients ? <p role="status" className="text-sm text-muted-foreground">Loading allowances…</p> : !monthlyAllowance ? <p className="text-sm text-muted-foreground">Monthly allowance data is unavailable.</p> : <div className="divide-y"><AllowanceRow label="Assessments" usage={monthlyAllowance.assessments} /><AllowanceRow label="Face scans" usage={monthlyAllowance.faceScans} /></div>}</div>
        </CardContent></Card>
        {!error && (usage && !hasRecentActivity ? <Card><CardContent className="py-8 text-center"><h2 className="font-semibold">{hasActivity ? "No activity in the last 6 months" : "No completed activity recorded yet"}</h2><p className="mt-1 text-sm text-muted-foreground">{hasActivity ? "Earlier completed activity is included in the lifetime totals above." : "Completed assessments and face scans will appear here once this deployment is used."}</p></CardContent></Card> : <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading chart…</p>}><UsageChart monthly={metrics?.monthly ?? null} title="Deployment usage" /></Suspense>)}
      </TabsContent>
      <TabsContent value="settings"><div className="grid gap-4 lg:grid-cols-2"><Card><CardContent className="space-y-4 pt-6"><h3 className="border-b pb-4 font-semibold">Configuration</h3><dl className="divide-y text-sm">{[["Client", client.name], ["Deployment label", label], ["Environment", environment], ["Hosting", deployment.hostingType ? hostingLabels[deployment.hostingType] : "Not specified"]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl></CardContent></Card><Card><CardContent className="space-y-4 pt-6"><h3 className="border-b pb-4 font-semibold">Rules &amp; limits</h3><dl className="divide-y text-sm">{[["Status", deployment.enabled ? "Enabled" : "Disabled"], ["Rule", deploymentVersion(data, deployment.id).label], ["Assessments", entitlement("SCORING")], ["Vital IQ", entitlement("FACE_SCAN")]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl></CardContent></Card></div></TabsContent>
      <TabsContent value="tokens" className="min-w-0"><ActivationTokenPanel deploymentId={deployment.id} disabled={false} creating={tokenCreating} onCreatingChange={setTokenCreating} /></TabsContent>
    </Tabs>
    {editing && <DeploymentDialog data={data} deployment={deployment} refresh={refreshDetails} onClose={() => setEditing(false)} onCreated={() => setEditing(false)} />}
  </section>;
}
