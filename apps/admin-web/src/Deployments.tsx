import { DeleteRecord } from "./DeleteRecord";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Overview } from "./Operations";
import { DeploymentDialog } from "./DeploymentDialog";
import { paginate } from "./pagination";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
export const hostingLabels = { NIQ_HOSTED: "NIQ hosted", CLIENT_CLOUD: "Client cloud", ON_PREMISES: "On-premises" };
export function Deployments({ data, refresh }: { data: Overview; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<Overview["deployments"][number] | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [hosting, setHosting] = useState("all");
  const [status, setStatus] = useState("all");
  const [environment, setEnvironment] = useState("all");
  const [page, setPage] = useState(1);
  const clientName = (id: string) => data.clients.find(client => client.id === id)?.name ?? id;
  const query = search.trim().toLocaleLowerCase();
  const deployments = paginate(data.deployments.filter(deployment =>
    clientName(deployment.clientId).toLocaleLowerCase().includes(query) &&
    (hosting === "all" || (deployment.hostingType ?? "unspecified") === hosting) &&
    (status === "all" || deployment.enabled === (status === "enabled")) &&
    (environment === "all" || deployment.environment === environment)
  ), page);
  const filter = (label: string, value: string, setValue: (value: string) => void, options: Array<[string, string]>) =>
    <Select value={value} onValueChange={next => { setValue(next); setPage(1); }}>
      <SelectTrigger aria-label={label} className="w-full sm:w-44"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">All {label.toLowerCase()}</SelectItem>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent>
    </Select>;
  const filtersActive = hosting !== "all" || status !== "all" || environment !== "all";
  return <Tabs defaultValue="deployments" className="gap-5">
    <div className="flex items-center justify-between gap-3">
      <TabsList variant="line" aria-label="Deployment management" className="p-0"><TabsTrigger value="deployments" className="rounded-none border-0 px-1 shadow-none data-[state=active]:text-primary after:bg-primary">Deployments <Badge variant="secondary" className="px-1.5 py-0 text-xs tabular-nums">{data.deployments.length}</Badge></TabsTrigger></TabsList>
      <div className="flex min-w-0 items-center justify-end gap-2"><div className="relative w-full max-w-xs"><Input aria-label="Search by client name" placeholder="Search clients…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="pr-9" />{search && <Button variant="ghost" size="icon" aria-label="Clear search" className="absolute right-0 top-0 size-9 text-muted-foreground" onClick={() => { setSearch(""); setPage(1); }}><X className="size-4" /></Button>}</div><Button size="icon" aria-label="Create deployment" onClick={() => setSelected(null)}><Plus /></Button></div>
    </div>
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
      {filter("Hosting", hosting, setHosting, [...Object.entries(hostingLabels).filter(([key]) => key !== "ON_PREMISES" || data.deployments.some(d => d.hostingType === key)) as Array<[string, string]>, ...(data.deployments.some(d => !d.hostingType) ? [["unspecified", "Not specified"] as [string, string]] : [])])}
      {filter("Statuses", status, setStatus, [["enabled", "Enabled"], ["disabled", "Disabled"]])}
      {filter("Environments", environment, setEnvironment, ["development", "test", "staging", "production"].map(value => [value, value.charAt(0).toUpperCase() + value.slice(1)]))}
      {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setHosting("all"); setStatus("all"); setEnvironment("all"); setPage(1); }}>Clear filters</Button>}
    </div>
    <TabsContent value="deployments" className="space-y-5"><Card><CardContent className="pt-6"><Table>
      <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Hosting</TableHead><TableHead>Environment</TableHead><TableHead>Status</TableHead><TableHead>Scoring</TableHead><TableHead>Face scan</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>{deployments.rows.map(deployment => <TableRow key={deployment.id}>
        <TableCell><Button variant="link" className="h-auto p-0 text-left font-medium" onClick={() => setSelected(deployment)}>{clientName(deployment.clientId)}</Button></TableCell>
        <TableCell>{deployment.hostingType ? hostingLabels[deployment.hostingType] : "Not specified"}</TableCell><TableCell className="capitalize">{deployment.environment}</TableCell><TableCell><Badge variant={deployment.enabled ? "default" : "secondary"}>{deployment.enabled ? "Enabled" : "Disabled"}</Badge></TableCell>
        {["SCORING", "FACE_SCAN"].map(capability => { const limit = data.entitlements.find(item => item.deploymentId === deployment.id && item.capability === capability); return <TableCell key={capability}>{!limit?.enabled ? "Disabled" : limit.monthlyLimit === null ? "Unlimited" : `${limit.monthlyLimit.toLocaleString()}/month`}</TableCell>; })}
        <TableCell className="text-right"><DeleteRecord kind="deployments" id={deployment.id} name={`${clientName(deployment.clientId)} ${deployment.environment} deployment`} refresh={refresh} revision={data} /></TableCell>
      </TableRow>)}
      {data.deployments.length === 0 && <TableRow><TableCell colSpan={7} className="h-32 text-center"><Button variant="ghost" onClick={() => setSelected(null)}><Plus />Create your first deployment</Button></TableCell></TableRow>}
      {data.deployments.length > 0 && deployments.total === 0 && <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No deployments match your search or filters.</TableCell></TableRow>}
      </TableBody></Table></CardContent></Card>
      <Pagination aria-label="Deployments pagination"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={deployments.page === 1} onClick={() => setPage(deployments.page - 1)}>Previous</Button></PaginationItem><PaginationItem><span className="flex flex-col items-center gap-1 px-2 text-xs text-muted-foreground sm:block sm:px-3 sm:text-sm" role="status"><span className="whitespace-nowrap">Page {deployments.page} of {deployments.pageCount}</span><span className="whitespace-nowrap"><span className="hidden sm:inline"> · </span>{deployments.total} total</span></span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={deployments.page === deployments.pageCount} onClick={() => setPage(deployments.page + 1)}>Next</Button></PaginationItem></PaginationContent></Pagination>
    </TabsContent>
    {selected !== undefined && <DeploymentDialog data={data} deployment={selected} refresh={refresh} onClose={() => setSelected(undefined)} />}
  </Tabs>;
}
