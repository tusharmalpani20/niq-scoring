import { lazy, Suspense, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
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

export function DeploymentDetail({ data, deploymentId, refresh }: { data: Overview; deploymentId: string; refresh: () => Promise<void> }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [tokenCreating, setTokenCreating] = useState(false);
  const deployment = data.deployments.find(item => item.id === deploymentId);
  const client = data.clients.find(item => item.id === deployment?.clientId);
  const { usage, error, retry } = useClientUsage(deployment?.clientId ?? "");
  if (!deployment || !client) return <p>Deployment not found. <Link to="/deployments" className="text-primary underline">Back to deployments</Link></p>;
  const metrics = usage?.find(item => item.deploymentId === deploymentId);
  const latest = metrics?.monthly.at(-1);
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
  const label = deploymentDisplayLabel(deployment);
  return <section className="min-w-0 space-y-4">
    <header className="space-y-2"><nav aria-label="Breadcrumb" className="text-sm"><Link to="/clients" className="text-primary hover:underline">Clients</Link><span className="mx-2 text-muted-foreground">/</span><Link to={clientUrl(client)} className="text-primary hover:underline">{client.name}</Link><span className="mx-2 text-muted-foreground">/</span><span className="text-muted-foreground">{label}</span></nav><div className="flex items-center justify-between gap-4"><div className="flex min-w-0 flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{label}</h1><Badge variant={deployment.enabled ? "default" : "secondary"}>{deployment.enabled ? "Enabled" : "Disabled"}</Badge></div>{tab === "settings" && <Button size="icon" aria-label="Edit deployment" title="Edit deployment" className="shrink-0" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden="true" /></Button>}{tab === "tokens" && <Button size="icon" aria-label="Create token" title="Create token" className="shrink-0" onClick={() => setTokenCreating(value => !value)}><Plus className="size-4" aria-hidden="true" /></Button>}</div><p className="text-sm text-muted-foreground">{client.name} · {environment} environment · {deployment.hostingType ? hostingLabels[deployment.hostingType] : "Hosting not specified"} · {deploymentVersion(data, deployment.id).label}</p></header>
    <Tabs value={tab} onValueChange={changeTab} className="gap-4"><TabsList variant="line" aria-label="Deployment details" className="h-auto min-h-11 w-full justify-start gap-6 rounded-none border-b p-0"><TabsTrigger value="overview" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Overview</TabsTrigger><TabsTrigger value="settings" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Settings &amp; limits</TabsTrigger><TabsTrigger value="tokens" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Tokens</TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-5">
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load usage. {error}<Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>}
        <div className="grid gap-4 sm:grid-cols-3">
          {[["Assessments scored", metrics?.assessments, "Successful events · all time"], ["Vital IQ scans completed", metrics?.vitalIq, "Successful scans · all time"], ["This month", latest ? `${latest.assessments.toLocaleString()} / ${latest.vitalIq.toLocaleString()}` : undefined, "Assessments / Vital IQ"]].map(([label, value, note]) => <Card key={label}><CardContent className="space-y-2 pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="text-3xl font-semibold tabular-nums">{value === undefined ? "—" : typeof value === "number" ? value.toLocaleString() : value}</p><p className="text-xs text-muted-foreground">{note}</p></CardContent></Card>)}
        </div>
        {!error && <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading chart…</p>}><UsageChart monthly={metrics?.monthly ?? (usage ? [] : null)} title="Deployment usage" /></Suspense>}
      </TabsContent>
      <TabsContent value="settings"><div className="grid gap-4 lg:grid-cols-2"><Card><CardContent className="space-y-4 pt-6"><h3 className="border-b pb-4 font-semibold">Configuration</h3><dl className="divide-y text-sm">{[["Client", client.name], ["Deployment label", label], ["Environment", environment], ["Hosting", deployment.hostingType ? hostingLabels[deployment.hostingType] : "Not specified"]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl></CardContent></Card><Card><CardContent className="space-y-4 pt-6"><h3 className="border-b pb-4 font-semibold">Rules &amp; limits</h3><dl className="divide-y text-sm">{[["Status", deployment.enabled ? "Enabled" : "Disabled"], ["Rule", deploymentVersion(data, deployment.id).label], ["Assessments", entitlement("SCORING")], ["Vital IQ", entitlement("FACE_SCAN")]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl></CardContent></Card></div></TabsContent>
      <TabsContent value="tokens" className="min-w-0"><ActivationTokenPanel deploymentId={deployment.id} disabled={false} creating={tokenCreating} onCreatingChange={setTokenCreating} /></TabsContent>
    </Tabs>
    {editing && <DeploymentDialog data={data} deployment={deployment} refresh={refresh} onClose={() => setEditing(false)} onCreated={() => setEditing(false)} />}
  </section>;
}
