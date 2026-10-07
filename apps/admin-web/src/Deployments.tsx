import { deploymentVersion } from "./deployment-version";
import { DeleteRecord } from "./DeleteRecord";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, X, Pencil } from "lucide-react";
import type { Overview } from "./Operations";
import { DeploymentDialog } from "./DeploymentDialog";
import { paginate } from "./pagination";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Tabs, TabsContent } from "./components/ui/tabs";
import { ListTab, ListTabHeader } from "./ListTabHeader";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import { clientUrl, deploymentUrl } from "./record-urls";
import { deploymentDisplayLabel } from "./deployment-label";
export const hostingLabels = { NIQ_HOSTED: "NIQ hosted", CLIENT_CLOUD: "Client cloud", ON_PREMISES: "On-premises" };

function DeploymentEmptyIllustration() {
  return <svg viewBox="0 0 192 136" className="h-28 w-40" aria-hidden="true" focusable="false">
    <circle cx="96" cy="64" r="56" fill="var(--accent)" />
    <ellipse cx="96" cy="125" rx="57" ry="4" fill="var(--border)" opacity="0.5" />
    <rect x="45" y="43" width="102" height="70" rx="10" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
    <path d="M58 62h76M58 84h76" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
    <circle cx="66" cy="54" r="3" fill="var(--primary)" /><circle cx="66" cy="74" r="3" fill="var(--primary)" /><circle cx="66" cy="96" r="3" fill="var(--primary)" />
    <circle cx="144" cy="35" r="18" fill="var(--primary)" />
    <path d="M144 27v16m-8-8h16" stroke="var(--primary-foreground)" strokeLinecap="round" strokeWidth="2.5" />
  </svg>;
}

export function Deployments({ data, refresh }: { data: Overview; refresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Overview["deployments"][number] | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [hosting, setHosting] = useState("all");
  const [status, setStatus] = useState("all");
  const [environment, setEnvironment] = useState("all");
  const [ruleVersion, setRuleVersion] = useState("all");
  const [page, setPage] = useState(1);
  const clientName = (id: string) => data.clients.find(client => client.id === id)?.name ?? id;
  const query = search.trim().toLocaleLowerCase();
  const deployments = paginate(data.deployments.filter(deployment =>
    (clientName(deployment.clientId).toLocaleLowerCase().includes(query) || deploymentDisplayLabel(deployment, data.deployments).toLocaleLowerCase().includes(query)) &&
    (hosting === "all" || (deployment.hostingType ?? "unspecified") === hosting) &&
    (status === "all" || deployment.enabled === (status === "enabled")) &&
    (environment === "all" || deployment.environment === environment) &&
    (ruleVersion === "all" || (ruleVersion === "default" ? deploymentVersion(data, deployment.id).followsDefault : ruleVersion === "unassigned" ? !deploymentVersion(data, deployment.id).id : deploymentVersion(data, deployment.id).id === ruleVersion))
  ), page);
  const filter = (label: string, value: string, setValue: (value: string) => void, options: Array<[string, string]>) =>
    <Select value={value} onValueChange={next => { setValue(next); setPage(1); }}>
      <SelectTrigger aria-label={label} className="w-full sm:w-44"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">All {label.toLowerCase()}</SelectItem>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent>
    </Select>;
  const filtersActive = hosting !== "all" || status !== "all" || environment !== "all" || ruleVersion !== "all";
  return <Tabs defaultValue="deployments" className="gap-5">
    <ListTabHeader label="Deployment management" tabs={<ListTab value="deployments" count={data.deployments.length}>Deployments</ListTab>} actions={
      <div className="flex min-w-0 items-center justify-end gap-2"><div className="relative w-full max-w-xs"><Input aria-label="Search by client or deployment label" placeholder="Search clients or deployments…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="pr-9" />{search && <Button variant="ghost" size="icon" aria-label="Clear search" className="absolute right-0 top-0 size-9 text-muted-foreground" onClick={() => { setSearch(""); setPage(1); }}><X className="size-4" /></Button>}</div><Button size="icon" aria-label="Create deployment" onClick={() => setSelected(null)}><Plus /></Button></div>
    } />
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
      {filter("Hosting", hosting, setHosting, [...Object.entries(hostingLabels).filter(([key]) => key !== "ON_PREMISES" || data.deployments.some(d => d.hostingType === key)) as Array<[string, string]>, ...(data.deployments.some(d => !d.hostingType) ? [["unspecified", "Not specified"] as [string, string]] : [])])}
      {filter("Statuses", status, setStatus, [["enabled", "Enabled"], ["disabled", "Disabled"]])}
      {filter("Environments", environment, setEnvironment, ["development", "test", "staging", "production"].map(value => [value, value.charAt(0).toUpperCase() + value.slice(1)]))}
      {filter("Rules", ruleVersion, setRuleVersion, [["default", "Following default"], ...data.versions.map(version => [version.id, version.version] as [string, string]), ["unassigned", "No available rule"]])}
      {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setHosting("all"); setStatus("all"); setEnvironment("all"); setRuleVersion("all"); setPage(1); }}>Clear filters</Button>}
    </div>
    <TabsContent value="deployments" className="space-y-5"><Card className={deployments.total > 0 ? "mobile-list-card" : undefined}><CardContent className="pt-6"><Table className={deployments.total > 0 ? "mobile-record-table deployment-record-table" : undefined}>
      <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Deployment</TableHead><TableHead>Hosting</TableHead><TableHead>Status</TableHead><TableHead>Rule</TableHead><TableHead>Assessments</TableHead><TableHead>Vital IQ</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>{deployments.rows.map(deployment => { const client = data.clients.find(item => item.id === deployment.clientId); return <TableRow key={deployment.id}>
        <TableCell data-label="Client">{client ? <Link to={clientUrl(client)} className="font-medium text-primary hover:underline">{client.name}</Link> : clientName(deployment.clientId)}</TableCell>
        <TableCell data-label="Deployment"><Link to={deploymentUrl(data, deployment)} className="font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{deploymentDisplayLabel(deployment, data.deployments)}</Link><span className="block text-xs capitalize text-muted-foreground">{deployment.environment} environment</span></TableCell>
        <TableCell data-label="Hosting">{deployment.hostingType ? hostingLabels[deployment.hostingType] : "Not specified"}</TableCell><TableCell data-label="Status"><Badge variant={deployment.enabled ? "success" : "inactive"}>{deployment.enabled ? "Enabled" : "Disabled"}</Badge></TableCell>
        <TableCell data-label="Rule">{deploymentVersion(data, deployment.id).label}</TableCell>
        {["SCORING", "FACE_SCAN"].map(capability => { const limit = data.entitlements.find(item => item.deploymentId === deployment.id && item.capability === capability); return <TableCell key={capability} data-label={capability === "SCORING" ? "Assessments" : "Vital IQ"}>{!limit?.enabled ? "Disabled" : limit.monthlyLimit === null ? "Unlimited" : `${limit.monthlyLimit.toLocaleString()}/month`}</TableCell>; })}
        <TableCell data-label="Actions" className="text-right"><div className="ml-auto grid w-[4.75rem] grid-cols-2 gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${clientName(deployment.clientId)} ${deploymentDisplayLabel(deployment, data.deployments)} deployment`} title="Edit deployment" onClick={() => setSelected(deployment)}><Pencil className="size-4" /></Button><DeleteRecord iconOnly kind="deployments" id={deployment.id} name={`${clientName(deployment.clientId)} ${deploymentDisplayLabel(deployment, data.deployments)} deployment`} refresh={refresh} revision={data} /></div></TableCell>
      </TableRow>; })}
      </TableBody></Table>
      {data.deployments.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 py-8 text-center"><DeploymentEmptyIllustration /><div className="space-y-1"><h2 className="font-semibold">No deployments yet</h2><p className="text-sm text-muted-foreground">Create a deployment to set up scoring for a client.</p></div><Button className="mt-2" onClick={() => setSelected(null)}><Plus aria-hidden="true" /> Create deployment</Button></div> : deployments.total === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No deployments match your search or filters.</p>}
      </CardContent></Card>
      {deployments.total > 0 && <Pagination aria-label="Deployments pagination"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={deployments.page === 1} onClick={() => setPage(deployments.page - 1)}>Previous</Button></PaginationItem><PaginationItem><span className="whitespace-nowrap px-2 text-xs text-muted-foreground sm:px-3 sm:text-sm" role="status">Page {deployments.page} of {deployments.pageCount}</span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={deployments.page === deployments.pageCount} onClick={() => setPage(deployments.page + 1)}>Next</Button></PaginationItem></PaginationContent></Pagination>}
    </TabsContent>
    {selected !== undefined && <DeploymentDialog data={data} deployment={selected} refresh={refresh} onClose={() => setSelected(undefined)} onCreated={id => { setSelected(undefined); navigate(`/deployments/${id}?tab=tokens`); }} />}
  </Tabs>;
}
