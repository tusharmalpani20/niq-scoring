import { DeleteRecord } from "./DeleteRecord";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, X, Pencil, ChevronDown } from "lucide-react";
import type { Overview } from "./Operations";
import { DeploymentDialog } from "./DeploymentDialog";
import { ListSkeleton } from "./ListSkeleton";
import { request, message } from "./api";
import { ErrorNotice } from "./shared";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Tabs, TabsContent } from "./components/ui/tabs";
import { ListTab, ListTabHeader } from "./ListTabHeader";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import { clientUrl } from "./record-urls";
export const hostingLabels = { NIQ_HOSTED: "NIQ hosted", CLIENT_CLOUD: "Client cloud", ON_PREMISES: "On-premises" };
type DeploymentRow = Overview["deployments"][number] & {
  clientName: string;
  displayLabel?: string;
  ruleLabel: string;
  assignment: Overview["assignments"][number] | null;
  entitlements: Overview["entitlements"];
};
type DeploymentPage = { items: DeploymentRow[]; total: number; page: number; pageSize: number; pageCount: number };

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

export function Deployments() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<DeploymentRow | null | undefined>(undefined);
  const [dialogData, setDialogData] = useState<Overview | null>(null);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [result, setResult] = useState<DeploymentPage>({ items: [], total: 0, page: 1, pageSize: 10, pageCount: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const sequence = useRef(0);
  const [search, setSearch] = useState("");
  const [hosting, setHosting] = useState("all");
  const [status, setStatus] = useState("all");
  const [environment, setEnvironment] = useState("all");
  const [ruleVersion, setRuleVersion] = useState("all");
  const [ruleLabel, setRuleLabel] = useState("All rules");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleSearch, setRuleSearch] = useState("");
  const [rulePage, setRulePage] = useState(1);
  const [ruleChoices, setRuleChoices] = useState<Array<{ id: string; version: string }>>([]);
  const [rulePageCount, setRulePageCount] = useState(1);
  const [ruleLoading, setRuleLoading] = useState(false);
  const [ruleError, setRuleError] = useState("");
  const ruleMenu = useRef<HTMLDetailsElement>(null);
  const [page, setPage] = useState(1);
  function pageParameters() {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (search.trim()) params.set("search", search.trim());
    if (hosting !== "all") params.set("hostingType", hosting);
    if (status !== "all") params.set("status", status);
    if (environment !== "all") params.set("environment", environment);
    if (ruleVersion !== "all") params.set("rule", ruleVersion);
    return params;
  }
  useEffect(() => {
    const current = ++sequence.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      setError("");
      const params = pageParameters();
      try {
        const next = await request<DeploymentPage>(`/admin/deployments?${params}`);
        if (current !== sequence.current) return;
        setResult(next);
        if (page > next.pageCount) setPage(next.pageCount);
      } catch (cause) { if (current === sequence.current) setError(message(cause)); }
      finally { if (current === sequence.current) setLoading(false); }
    }, search ? 200 : 0);
    return () => { ++sequence.current; window.clearTimeout(timer); };
  }, [page, search, hosting, status, environment, ruleVersion, reload]);
  useEffect(() => {
    if (selected === undefined) { setDialogData(null); return; }
    let current = true;
    setDialogData(null);
    setDialogLoading(true);
    setDialogError("");
    void request<Overview>("/admin/overview").then(data => { if (current) setDialogData(data); })
      .catch(cause => { if (current) setDialogError(message(cause)); })
      .finally(() => { if (current) setDialogLoading(false); });
    return () => { current = false; };
  }, [selected]);
  useEffect(() => {
    if (!ruleOpen) return;
    let current = true;
    setRuleLoading(true);
    setRuleError("");
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ page: String(rulePage), pageSize: "10" });
      if (ruleSearch.trim()) params.set("search", ruleSearch.trim());
      try {
        const next = await request<{ versions: Array<{ id: string; version: string }>; pageCount: number }>(`/admin/rules?${params}`);
        if (current) { setRuleChoices(next.versions); setRulePageCount(next.pageCount); }
      } catch (cause) { if (current) setRuleError(message(cause)); }
      finally { if (current) setRuleLoading(false); }
    }, ruleSearch ? 200 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [ruleOpen, rulePage, ruleSearch]);
  async function refresh() {
    const current = ++sequence.current;
    setLoading(true);
    try {
      // The dialog must retain its one-time token until the refresh really succeeds.
      const next = await request<DeploymentPage>(`/admin/deployments?${pageParameters()}`);
      if (current !== sequence.current) throw new Error("Deployment list changed while refreshing. Retry the refresh.");
      setResult(next);
      setError("");
      if (page > next.pageCount) setPage(next.pageCount);
    } catch (cause) {
      if (current === sequence.current) setError(message(cause));
      throw cause;
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }
  const deploymentUrl = (deployment: DeploymentRow) => `/deployments/${clientUrl({ id: deployment.clientId, name: deployment.clientName, enabled: true }).slice("/clients/".length)}/${deployment.id}`;
  const clientName = (deployment: DeploymentRow) => deployment.clientName || deployment.clientId;
  const deploymentLabel = (deployment: DeploymentRow) => deployment.displayLabel ?? deployment.name;
  function openDialog(deployment: DeploymentRow | null) { setDialogData(null); setSelected(deployment); }
  function selectRule(value: string, label: string) { setRuleVersion(value); setRuleLabel(label); setPage(1); if (ruleMenu.current) ruleMenu.current.open = false; }
  const filter = (label: string, value: string, setValue: (value: string) => void, options: Array<[string, string]>) =>
    <Select value={value} onValueChange={next => { setValue(next); setPage(1); }}>
      <SelectTrigger aria-label={label} className="w-full sm:w-44"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">All {label.toLowerCase()}</SelectItem>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent>
    </Select>;
  const filtersActive = hosting !== "all" || status !== "all" || environment !== "all" || ruleVersion !== "all";
  return <Tabs defaultValue="deployments" className="gap-5">
    <ListTabHeader label="Deployment management" tabs={<ListTab value="deployments" count={result.total}>Deployments</ListTab>} actions={
      <div className="flex min-w-0 items-center justify-end gap-2"><div className="relative w-full max-w-xs"><Input aria-label="Search by client or deployment label" placeholder="Search clients or deployments…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="pr-9" />{search && <Button variant="ghost" size="icon" aria-label="Clear search" className="absolute right-0 top-0 size-9 text-muted-foreground" onClick={() => { setSearch(""); setPage(1); }}><X className="size-4" /></Button>}</div><Button size="icon" aria-label="Create deployment" onClick={() => openDialog(null)}><Plus /></Button></div>
    } />
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
      {filter("Hosting", hosting, setHosting, [...Object.entries(hostingLabels), ["unspecified", "Not specified"]] as Array<[string, string]>)}
      {filter("Statuses", status, setStatus, [["enabled", "Enabled"], ["disabled", "Disabled"]])}
      {filter("Environments", environment, setEnvironment, ["development", "test", "staging", "production"].map(value => [value, value.charAt(0).toUpperCase() + value.slice(1)]))}
      <details ref={ruleMenu} onToggle={event => setRuleOpen(event.currentTarget.open)} className="relative w-full sm:w-44">
        <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm marker:hidden focus-visible:outline-2 focus-visible:outline-ring"><span className="truncate">{ruleLabel}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></summary>
        <div className="absolute left-0 z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-2 shadow-md">
          <Input aria-label="Search rule filter options" placeholder="Search rules…" value={ruleSearch} onChange={event => { setRuleSearch(event.target.value); setRulePage(1); }} />
          <div className="mt-2 max-h-56 overflow-y-auto text-sm">
            {([["all", "All rules"], ["default", "Following default"], ["unassigned", "No available rule"]] as Array<[string, string]>).map(([value, label]) => <button type="button" key={value} className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent" onClick={() => selectRule(value, label)}>{label}</button>)}
            {ruleLoading ? <p role="status" className="px-2 py-2 text-muted-foreground">Loading rules…</p> : ruleError ? <p role="alert" className="px-2 py-2 text-destructive">{ruleError}</p> : ruleChoices.map(rule => <button type="button" key={rule.id} className="block w-full break-all rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent" onClick={() => selectRule(rule.id, rule.version)}>{rule.version}</button>)}
          </div>
          {rulePageCount > 1 && <div className="flex items-center justify-between border-t pt-2 text-xs"><Button type="button" variant="ghost" size="sm" disabled={rulePage === 1 || ruleLoading} onClick={() => setRulePage(value => value - 1)}>Previous</Button><span>{rulePage} of {rulePageCount}</span><Button type="button" variant="ghost" size="sm" disabled={rulePage === rulePageCount || ruleLoading} onClick={() => setRulePage(value => value + 1)}>Next</Button></div>}
        </div>
      </details>
      {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setHosting("all"); setStatus("all"); setEnvironment("all"); setRuleVersion("all"); setRuleLabel("All rules"); setPage(1); }}>Clear filters</Button>}
    </div>
    <TabsContent value="deployments" className="space-y-5"><ErrorNotice error={error} />{error && <Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry</Button>}
      {loading ? <ListSkeleton label="deployments" columns={8} /> : <Card className={result.total > 0 ? "mobile-list-card" : undefined}><CardContent className="pt-6"><Table className={result.total > 0 ? "mobile-record-table deployment-record-table" : undefined}>
      <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Deployment</TableHead><TableHead>Hosting</TableHead><TableHead>Status</TableHead><TableHead>Rule</TableHead><TableHead>Assessments</TableHead><TableHead>Vital IQ</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>{result.items.map(deployment => <TableRow key={deployment.id}>
        <TableCell data-label="Client"><Link to={clientUrl({ id: deployment.clientId, name: clientName(deployment), enabled: true })} className="font-medium text-primary hover:underline">{clientName(deployment)}</Link></TableCell>
        <TableCell data-label="Deployment"><Link to={deploymentUrl(deployment)} className="font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{deploymentLabel(deployment)}</Link><span className="block text-xs capitalize text-muted-foreground">{deployment.environment} environment</span></TableCell>
        <TableCell data-label="Hosting">{deployment.hostingType ? hostingLabels[deployment.hostingType] : "Not specified"}</TableCell><TableCell data-label="Status"><Badge variant={deployment.enabled ? "success" : "inactive"}>{deployment.enabled ? "Enabled" : "Disabled"}</Badge></TableCell>
        <TableCell data-label="Rule">{deployment.ruleLabel}</TableCell>
        {["SCORING", "FACE_SCAN"].map(capability => { const limit = deployment.entitlements.find(item => item.capability === capability); return <TableCell key={capability} data-label={capability === "SCORING" ? "Assessments" : "Vital IQ"}>{!limit?.enabled ? "Disabled" : limit.monthlyLimit === null ? "Unlimited" : `${limit.monthlyLimit.toLocaleString()}/month`}</TableCell>; })}
        <TableCell data-label="Actions" className="text-right"><div className="ml-auto grid w-[4.75rem] grid-cols-2 gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${clientName(deployment)} ${deploymentLabel(deployment)} deployment`} title="Edit deployment" onClick={() => openDialog(deployment)}><Pencil className="size-4" /></Button><DeleteRecord iconOnly kind="deployments" id={deployment.id} name={`${clientName(deployment)} ${deploymentLabel(deployment)} deployment`} refresh={refresh} revision={deployment} /></div></TableCell>
      </TableRow>)}
      </TableBody></Table>
      {!error && (result.total === 0 && !search && !filtersActive ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 py-8 text-center"><DeploymentEmptyIllustration /><div className="space-y-1"><h2 className="font-semibold">No deployments yet</h2><p className="text-sm text-muted-foreground">Create a deployment to set up scoring for a client.</p></div><Button className="mt-2" onClick={() => openDialog(null)}><Plus aria-hidden="true" /> Create deployment</Button></div> : result.total === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No deployments match your search or filters.</p>)}
      </CardContent></Card>}
      {!loading && result.total > 0 && <Pagination aria-label="Deployments pagination"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button></PaginationItem><PaginationItem><span className="whitespace-nowrap px-2 text-xs text-muted-foreground sm:px-3 sm:text-sm" role="status">Page {page} of {result.pageCount}</span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={page === result.pageCount} onClick={() => setPage(page + 1)}>Next</Button></PaginationItem></PaginationContent></Pagination>}
    </TabsContent>
    {selected !== undefined && (dialogLoading ? <div role="status" className="text-sm text-muted-foreground">Loading deployment settings…</div> : dialogError ? <div><ErrorNotice error={dialogError} /><Button variant="outline" onClick={() => setSelected(undefined)}>Close</Button></div> : dialogData && <DeploymentDialog data={dialogData} deployment={selected && (dialogData.deployments.find(item => item.id === selected.id) ?? selected)} refresh={refresh} onClose={() => setSelected(undefined)} onCreated={id => { setSelected(undefined); navigate(`/deployments/${id}?tab=tokens`); }} />)}
  </Tabs>;
}
