import { versionUrl } from "./rules/version-url";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Plus, X, Copy, Trash2, Pencil } from "lucide-react";
import { request, message } from "./api";
import { ErrorNotice } from "./shared";
import { RuleCreate } from "./rules/RuleCreate";
import type { RuleMetadata } from "./rules/rule-api";
import { NativeSelect } from "./components/ui/native-select";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";
import { paginate } from "./pagination";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Tabs, TabsContent } from "./components/ui/tabs";
import { ListTab, ListTabHeader } from "./ListTabHeader";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import { ruleStatusVariant } from "./rules/rule-status";
import { PROVISIONAL_SCORING_VERSION } from "@niq-scoring/contracts";

function RuleEmptyIllustration() {
  return <svg viewBox="0 0 192 136" className="h-28 w-40" aria-hidden="true" focusable="false">
    <circle cx="96" cy="64" r="56" fill="var(--accent)" />
    <ellipse cx="96" cy="125" rx="57" ry="4" fill="var(--border)" opacity="0.5" />
    <path d="m48 87 48 25 48-25-48-25-48 25Zm0-20 48 25 48-25-48-25-48 25Zm0-20 48 25 48-25-48-25-48 25Z" fill="var(--card)" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="145" cy="35" r="18" fill="var(--primary)" />
    <path d="M145 27v16m-8-8h16" stroke="var(--primary-foreground)" strokeLinecap="round" strokeWidth="2.5" />
  </svg>;
}

export function RuleVersions({ refresh }: { refresh: () => Promise<void> }) {
  const [records, setRecords] = useState<RuleMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState<RuleMetadata | undefined>();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<RuleMetadata | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() { setLoading(true); setError(""); try { setRecords((await request<{ versions: RuleMetadata[] }>("/admin/rules")).versions.filter(version => version.version !== PROVISIONAL_SCORING_VERSION)); } catch(cause) { setError(message(cause)); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  function open(name: string) { navigate(versionUrl(name)); }
  function createRule() { setSource(undefined); setCreating(true); }
  function updated() { void load(); void refresh().catch(cause => setError(message(cause))); }
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = search.trim().toLowerCase();
  const versions = paginate(records.filter(version => version.version.toLowerCase().includes(query) && (!status || version.lifecycle === status)), page);
  return <><ErrorNotice error={error} />{error && <Button variant="outline" onClick={() => void load()}>Retry</Button>}<Tabs defaultValue="versions" className="gap-5">
    <ListTabHeader label="Rule management" tabs={<ListTab value="versions" count={records.length}>Rules</ListTab>} actions={
      <div className="flex min-w-0 items-center justify-end gap-2">
      <div className="relative min-w-0 w-full max-w-xs">
        <Input aria-label="Search rules" placeholder="Search rules…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="pr-9" />
        {search && <Button type="button" variant="ghost" size="icon" aria-label="Clear search" className="absolute right-0 top-0 size-9 text-muted-foreground hover:text-foreground" onClick={() => { setSearch(""); setPage(1); }}><X className="size-4" aria-hidden="true" /></Button>}
      </div>
      <Button size="icon" aria-label="Create rule" title="Create rule" onClick={createRule}><Plus aria-hidden="true" /></Button>
      </div>
    } />
    <TabsContent value="versions" className="space-y-5">
      <div className="max-w-xs"><NativeSelect aria-label="Filter by lifecycle" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{["DRAFT", "VALIDATED", "APPROVED", "ACTIVE", "RETIRED"].map(value => <option key={value} value={value}>{value === "VALIDATED" ? "Checked" : value.charAt(0) + value.slice(1).toLowerCase()}</option>)}</NativeSelect></div>
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading rules…</p>}
      <Card className={versions.total > 0 ? "mobile-list-card" : undefined}><CardContent className="pt-6"><Table className={versions.total > 0 ? "mobile-record-table" : undefined}>
        <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Status</TableHead><TableHead>Clinical use</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
        <TableBody>
          {versions.rows.map(version => <TableRow key={version.id}>
            <TableCell data-label="Rule" className="font-medium"><Button variant="link" className="h-auto whitespace-normal p-0 text-left text-primary" disabled={busy} onClick={() => void open(version.version)}>{version.version}</Button>{version.isDefault && <Badge variant="highlight" className="ml-2">Default</Badge>}</TableCell>
            <TableCell data-label="Status"><Badge variant={ruleStatusVariant(version.lifecycle)}>{version.lifecycle === "VALIDATED" ? "Checked" : version.lifecycle.charAt(0) + version.lifecycle.slice(1).toLowerCase()}</Badge></TableCell>
            <TableCell data-label="Clinical use"><Badge variant={version.clinicalUsePermitted ? "success" : "inactive"}>{version.clinicalUsePermitted ? "Permitted" : "Prohibited"}</Badge></TableCell>
            <TableCell data-label="Actions"><div className="flex justify-end gap-1">{version.editable && <Button variant="ghost" size="icon" title={`Edit ${version.version}`} aria-label={`Edit ${version.version}`} onClick={() => open(version.version)}><Pencil className="size-4" /></Button>}<Button variant="ghost" size="icon" title={`Duplicate ${version.version}`} aria-label={`Duplicate ${version.version}`} disabled={busy || version.duplicable === false} onClick={() => { setSource(version); setCreating(true); }}><Copy className="size-4" /></Button>{(version.deletable ?? version.editable) && version.lifecycle === "DRAFT" && <Button variant="ghost" size="icon" className="text-destructive" title={`Delete ${version.version}`} aria-label={`Delete ${version.version}`} onClick={() => { setError(""); setDeleting(version); }}><Trash2 className="size-4" /></Button>}</div></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
      {!loading && !error && (records.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 py-8 text-center"><RuleEmptyIllustration /><div className="space-y-1"><h2 className="font-semibold">No rules yet</h2><p className="text-sm text-muted-foreground">Create a rule to define how assessments are scored.</p></div><Button className="mt-2" onClick={createRule}><Plus aria-hidden="true" /> Create rule</Button></div> : versions.total === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No rules match your search or filter.</p>)}
      </CardContent></Card>
      {versions.total > 0 && <Pagination aria-label="Rules pagination"><PaginationContent>
        <PaginationItem><Button variant="outline" size="sm" disabled={versions.page === 1} onClick={() => setPage(versions.page - 1)}>Previous</Button></PaginationItem>
        <PaginationItem><span className="whitespace-nowrap px-2 text-xs text-muted-foreground sm:px-3 sm:text-sm" role="status">Page {versions.page} of {versions.pageCount}</span></PaginationItem>
        <PaginationItem><Button variant="outline" size="sm" disabled={versions.page === versions.pageCount} onClick={() => setPage(versions.page + 1)}>Next</Button></PaginationItem>
      </PaginationContent></Pagination>}
    </TabsContent>
  </Tabs>
  {creating && <RuleCreate {...(source ? { source } : {})} onClose={() => setCreating(false)} onCreated={record => { setCreating(false); updated(); open(record.version); }} />}
  <AlertDialog open={deleting !== null} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleting?.version}?</AlertDialogTitle><AlertDialogDescription>This permanently deletes the draft. Its activity history will be kept.</AlertDialogDescription></AlertDialogHeader><ErrorNotice error={error} /><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={async event => { event.preventDefault(); if (!deleting) return; setBusy(true); setError(""); try { await request(`/admin/rules/${deleting.id}`, { revision: deleting.revision }, "DELETE"); setDeleting(null); updated(); } catch(cause) { setError(message(cause)); } finally { setBusy(false); } }}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
