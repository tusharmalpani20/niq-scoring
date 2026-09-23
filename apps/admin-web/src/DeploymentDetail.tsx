import { lazy, Suspense, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Pencil } from "lucide-react";
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

const UsageChart = lazy(() => import("./UsageChart").then(module => ({ default: module.UsageChart })));

export function DeploymentDetail({ data, deploymentId, refresh }: { data: Overview; deploymentId: string; refresh: () => Promise<void> }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
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
  const tab = ["overview", "settings", "tokens"].includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "overview";
  const changeTab = (value: string) => setSearchParams(value === "overview" ? {} : { tab: value }, { replace: true });
  const environment = deployment.environment.charAt(0).toUpperCase() + deployment.environment.slice(1);
  return <section className="min-w-0 space-y-6">
    <header className="space-y-4"><nav aria-label="Breadcrumb" className="text-sm"><Link to="/clients" className="text-primary hover:underline">Clients</Link><span className="mx-2 text-muted-foreground">/</span><Link to={`/clients/${client.id}`} className="text-primary hover:underline">{client.name}</Link><span className="mx-2 text-muted-foreground">/</span><span className="text-muted-foreground">{environment}</span></nav><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{environment}</h1><Badge variant={deployment.enabled ? "default" : "secondary"}>{deployment.enabled ? "Enabled" : "Disabled"}</Badge></div><p className="text-sm text-muted-foreground">{client.name} · {deployment.hostingType ? hostingLabels[deployment.hostingType] : "Hosting not specified"} · {deploymentVersion(data, deployment.id).label}</p></header>
    <Tabs value={tab} onValueChange={changeTab} className="gap-5"><TabsList variant="line" aria-label="Deployment details" className="w-full justify-start gap-5 rounded-none border-b p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="settings">Settings &amp; limits</TabsTrigger><TabsTrigger value="tokens">Tokens</TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-5">
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load usage. {error}<Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>}
        <div className="grid gap-4 sm:grid-cols-3">
          {[["Assessments scored", metrics?.assessments, "Successful events · all time"], ["Vital IQ scans completed", metrics?.vitalIq, "Successful scans · all time"], ["This month", latest ? `${latest.assessments.toLocaleString()} / ${latest.vitalIq.toLocaleString()}` : undefined, "Assessments / Vital IQ · UTC"]].map(([label, value, note]) => <Card key={label}><CardContent className="space-y-2 pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="text-3xl font-semibold tabular-nums">{value === undefined ? "—" : typeof value === "number" ? value.toLocaleString() : value}</p><p className="text-xs text-muted-foreground">{note}</p></CardContent></Card>)}
        </div>
        {!error && <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading chart…</p>}><UsageChart monthly={metrics?.monthly ?? (usage ? [] : null)} title="Deployment usage" /></Suspense>}
      </TabsContent>
      <TabsContent value="settings" className="space-y-4"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Settings &amp; limits</h2><Button variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden="true" />Edit deployment</Button></div><div className="grid gap-4 lg:grid-cols-2"><Card><CardContent className="space-y-4 pt-6"><h3 className="font-semibold">Configuration</h3><dl className="divide-y text-sm">{[["Client", client.name], ["Environment", environment], ["Hosting", deployment.hostingType ? hostingLabels[deployment.hostingType] : "Not specified"], ["Status", deployment.enabled ? "Enabled" : "Disabled"], ["Rule", deploymentVersion(data, deployment.id).label]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl></CardContent></Card><Card><CardContent className="space-y-4 pt-6"><h3 className="font-semibold">Monthly limits</h3><dl className="divide-y text-sm">{[["Assessments", entitlement("SCORING")], ["Vital IQ", entitlement("FACE_SCAN")]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl></CardContent></Card></div></TabsContent>
      <TabsContent value="tokens" className="max-w-full overflow-x-auto"><ActivationTokenPanel deploymentId={deployment.id} disabled={false} /></TabsContent>
    </Tabs>
    {editing && <DeploymentDialog data={data} deployment={deployment} refresh={refresh} onClose={() => setEditing(false)} onCreated={() => setEditing(false)} />}
  </section>;
}
