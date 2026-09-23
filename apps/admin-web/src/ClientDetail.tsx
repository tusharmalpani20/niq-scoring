import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Overview } from "./Operations";
import { DeploymentDialog } from "./DeploymentDialog";
import { useClientUsage } from "./client-usage";
import { UsageChart } from "./UsageChart";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";

export function ClientDetail({ data, clientId, refresh }: { data: Overview; clientId: string; refresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { usage, error, retry } = useClientUsage(clientId);
  const client = data.clients.find(item => item.id === clientId);
  if (!client) return <p>Client not found. <Link to="/clients" className="text-primary underline">Back to clients</Link></p>;
  const deployments = data.deployments.filter(item => item.clientId === clientId);
  const total = (key: "assessments" | "vitalIq") => usage?.reduce((sum, item) => sum + item[key], 0);
  const monthly = usage?.[0]?.monthly.map(({ month }) => ({ month, assessments: usage.reduce((sum, item) => sum + (item.monthly.find(entry => entry.month === month)?.assessments ?? 0), 0), vitalIq: usage.reduce((sum, item) => sum + (item.monthly.find(entry => entry.month === month)?.vitalIq ?? 0), 0) })) ?? (usage ? [] : null);
  return <section className="min-w-0 space-y-6">
    <header className="space-y-4"><nav aria-label="Breadcrumb" className="text-sm"><Link to="/clients" className="text-primary hover:underline">Clients</Link><span className="mx-2 text-muted-foreground">/</span><span className="text-muted-foreground">{client.name}</span></nav><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{client.name}</h1><Badge variant={client.enabled ? "default" : "secondary"}>{client.enabled ? "Enabled" : "Disabled"}</Badge></div><p className="text-sm text-muted-foreground">{deployments.length} {deployments.length === 1 ? "deployment" : "deployments"}</p></header>
    <Tabs defaultValue="overview" className="gap-5"><TabsList variant="line" aria-label="Client details" className="w-full justify-start gap-5 rounded-none border-b p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="deployments">Deployments <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{deployments.length}</Badge></TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-5">
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load usage. {error}<Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>}
        <div className="grid gap-4 sm:grid-cols-3">
          {[["Assessments scored", total("assessments"), "Successful events · all time"], ["Vital IQ scans completed", total("vitalIq"), "Successful scans · all time"], ["Deployments", deployments.length, "Across this client"]].map(([label, value, note]) => <Card key={label}><CardContent className="space-y-2 pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="text-3xl font-semibold tabular-nums">{value === undefined ? "—" : Number(value).toLocaleString()}</p><p className="text-xs text-muted-foreground">{note}</p></CardContent></Card>)}
        </div>
        {!error && <UsageChart monthly={monthly} />}
      </TabsContent>
      <TabsContent value="deployments" className="space-y-4"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Deployments</h2><Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />Create deployment</Button></div><Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Environment</TableHead><TableHead>Hosting</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Assessments</TableHead><TableHead className="text-right">Vital IQ</TableHead></TableRow></TableHeader><TableBody>{deployments.map(item => { const counts = usage?.find(entry => entry.deploymentId === item.id); return <TableRow key={item.id}><TableCell><Link to={`/deployments/${item.id}`} className="font-medium text-primary hover:underline">{item.environment.charAt(0).toUpperCase() + item.environment.slice(1)}</Link></TableCell><TableCell>{item.hostingType === "NIQ_HOSTED" ? "NIQ hosted" : item.hostingType === "CLIENT_CLOUD" ? "Client cloud" : "Not specified"}</TableCell><TableCell>{item.enabled ? "Enabled" : "Disabled"}</TableCell><TableCell className="text-right tabular-nums">{counts?.assessments.toLocaleString() ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{counts?.vitalIq.toLocaleString() ?? "—"}</TableCell></TableRow>; })}{deployments.length === 0 && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No deployments yet.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>
    </Tabs>
    {creating && <DeploymentDialog data={data} deployment={null} initialClientId={clientId} refresh={refresh} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); navigate(`/deployments/${id}?tab=tokens`); }} />}
  </section>;
}
