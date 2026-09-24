import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import type { Overview } from "./Operations";
import { DeploymentDialog } from "./DeploymentDialog";
import { useClientUsage } from "./client-usage";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { RuleUsagePanel } from "./RuleUsagePanel";
import { deploymentVersion } from "./deployment-version";
import { hostingLabels } from "./Deployments";
import { DeleteRecord } from "./DeleteRecord";
import { paginate } from "./pagination";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";

const UsageChart = lazy(() => import("./UsageChart").then(module => ({ default: module.UsageChart })));

export function ClientDetail({ data, clientId, refresh }: { data: Overview; clientId: string; refresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [selectedDeployment, setSelectedDeployment] = useState<Overview["deployments"][number] | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("overview");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [clientId]);
  const { usage, error, retry } = useClientUsage(clientId);
  const client = data.clients.find(item => item.id === clientId);
  if (!client) return <p>Client not found. <Link to="/clients" className="text-primary underline">Back to clients</Link></p>;
  const deployments = data.deployments.filter(item => item.clientId === clientId);
  const deploymentPage = paginate(deployments, page);
  const total = (key: "assessments" | "vitalIq") => usage?.reduce((sum, item) => sum + item[key], 0);
  const monthly = usage?.[0]?.monthly.map(({ month }) => ({ month, assessments: usage.reduce((sum, item) => sum + (item.monthly.find(entry => entry.month === month)?.assessments ?? 0), 0), vitalIq: usage.reduce((sum, item) => sum + (item.monthly.find(entry => entry.month === month)?.vitalIq ?? 0), 0) })) ?? (usage ? [] : null);
  return <section className="min-w-0 space-y-4">
    <header className="space-y-2"><nav aria-label="Breadcrumb" className="text-sm"><Link to="/clients" className="text-primary hover:underline">Clients</Link><span className="mx-2 text-muted-foreground">/</span><span className="text-muted-foreground">{client.name}</span></nav><div className="flex items-center justify-between gap-4"><div className="flex min-w-0 flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{client.name}</h1><Badge variant={client.enabled ? "default" : "secondary"}>{client.enabled ? "Enabled" : "Disabled"}</Badge></div>{activeTab === "deployments" && <Button size="icon" aria-label="Create deployment" title="Create deployment" className="shrink-0" onClick={() => setSelectedDeployment(null)}><Plus className="size-4" aria-hidden="true" /></Button>}</div><p className="text-sm text-muted-foreground">{deployments.length} {deployments.length === 1 ? "deployment" : "deployments"}</p></header>
    <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4"><TabsList variant="line" aria-label="Client details" className="h-auto min-h-11 w-full justify-start gap-6 rounded-none border-b p-0"><TabsTrigger value="overview" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Overview</TabsTrigger><TabsTrigger value="deployments" className="h-11 flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary">Deployments <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{deployments.length}</Badge></TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-5">
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load usage. {error}<Button variant="outline" size="sm" onClick={retry}>Retry</Button></div>}
        <div className="grid gap-4 sm:grid-cols-3">
          {[["Assessments scored", total("assessments"), "Successful events · all time"], ["Vital IQ scans completed", total("vitalIq"), "Successful scans · all time"], ["Deployments", deployments.length, "Across this client"]].map(([label, value, note]) => <Card key={label}><CardContent className="space-y-2 pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="text-3xl font-semibold tabular-nums">{value === undefined ? "—" : Number(value).toLocaleString()}</p><p className="text-xs text-muted-foreground">{note}</p></CardContent></Card>)}
        </div>
        {!error && <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading chart…</p>}><UsageChart monthly={monthly} /></Suspense>}
        <RuleUsagePanel clientId={clientId} />
      </TabsContent>
      <TabsContent value="deployments" className="space-y-5"><Card><CardContent className="pt-6"><div className="max-w-full overflow-x-auto"><Table className="min-w-[820px]"><TableHeader><TableRow><TableHead>Environment</TableHead><TableHead>Hosting</TableHead><TableHead>Status</TableHead><TableHead>Rule</TableHead><TableHead className="text-right">Assessments · all time</TableHead><TableHead className="text-right">Vital IQ · all time</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{deploymentPage.rows.map(item => { const counts = usage?.find(entry => entry.deploymentId === item.id); return <TableRow key={item.id}><TableCell><Link to={`/deployments/${item.id}`} className="font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{item.environment.charAt(0).toUpperCase() + item.environment.slice(1)}</Link></TableCell><TableCell>{item.hostingType ? hostingLabels[item.hostingType] : "Not specified"}</TableCell><TableCell><Badge variant={item.enabled ? "default" : "secondary"}>{item.enabled ? "Enabled" : "Disabled"}</Badge></TableCell><TableCell>{deploymentVersion(data, item.id).label}</TableCell><TableCell className="text-right tabular-nums">{counts?.assessments.toLocaleString() ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{counts?.vitalIq.toLocaleString() ?? "—"}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${item.environment} deployment`} title="Edit deployment" onClick={() => setSelectedDeployment(item)}><Pencil className="size-4" /></Button><DeleteRecord iconOnly kind="deployments" id={item.id} name={`${client.name} ${item.environment} deployment`} refresh={refresh} revision={data} /></div></TableCell></TableRow>; })}{deployments.length === 0 && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No deployments yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
        {deploymentPage.pageCount > 1 && <Pagination aria-label="Client deployments pagination"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={deploymentPage.page === 1} onClick={() => setPage(deploymentPage.page - 1)}>Previous</Button></PaginationItem><PaginationItem><span className="flex flex-col items-center gap-1 px-2 text-xs text-muted-foreground sm:block sm:px-3 sm:text-sm" role="status"><span className="whitespace-nowrap">Page {deploymentPage.page} of {deploymentPage.pageCount}</span><span className="whitespace-nowrap"><span className="hidden sm:inline"> · </span>{deploymentPage.total} total</span></span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={deploymentPage.page === deploymentPage.pageCount} onClick={() => setPage(deploymentPage.page + 1)}>Next</Button></PaginationItem></PaginationContent></Pagination>}
      </TabsContent>
    </Tabs>
    {selectedDeployment !== undefined && <DeploymentDialog data={data} deployment={selectedDeployment} initialClientId={clientId} refresh={refresh} onClose={() => setSelectedDeployment(undefined)} onCreated={id => { setSelectedDeployment(undefined); navigate(`/deployments/${id}?tab=tokens`); }} />}
  </section>;
}
