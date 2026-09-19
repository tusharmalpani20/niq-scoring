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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";

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
  async function load() { setLoading(true); setError(""); try { setRecords((await request<{ versions: RuleMetadata[] }>("/admin/rules")).versions); } catch(cause) { setError(message(cause)); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  function open(name: string) { navigate(versionUrl(name)); }
  function updated() { void load(); void refresh().catch(cause => setError(message(cause))); }
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = search.trim().toLowerCase();
  const versions = paginate(records.filter(version => version.version.toLowerCase().includes(query) && (!status || version.lifecycle === status)), page);
  return <><ErrorNotice error={error} />{error && <Button variant="outline" onClick={() => void load()}>Retry</Button>}<Tabs defaultValue="versions" className="gap-5">
    <div className="flex items-center justify-between gap-3">
      <TabsList variant="line" aria-label="Rule version management" className="shrink-0 p-0">
        <TabsTrigger value="versions" className="rounded-none border-0 px-1 shadow-none data-[state=active]:text-primary after:bg-primary">Rule versions <Badge variant="secondary" className="px-1.5 py-0 text-xs tabular-nums">{records.length}</Badge></TabsTrigger>
      </TabsList>
      <div className="flex min-w-0 items-center justify-end gap-2">
      <div className="relative min-w-0 w-full max-w-xs">
        <Input aria-label="Search rule versions" placeholder="Search versions…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="pr-9" />
        {search && <Button type="button" variant="ghost" size="icon" aria-label="Clear search" className="absolute right-0 top-0 size-9 text-muted-foreground hover:text-foreground" onClick={() => { setSearch(""); setPage(1); }}><X className="size-4" aria-hidden="true" /></Button>}
      </div>
      <Button size="icon" aria-label="Create rule version" title="Create rule version" onClick={() => { setSource(undefined); setCreating(true); }}><Plus aria-hidden="true" /></Button>
      </div>
    </div>
    <TabsContent value="versions" className="space-y-5">
      <div className="max-w-xs"><NativeSelect aria-label="Filter by lifecycle" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{["DRAFT", "VALIDATED", "APPROVED", "ACTIVE", "RETIRED"].map(value => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}</NativeSelect></div>
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading versions…</p>}
      <Card><CardContent className="pt-6"><Table>
        <TableHeader><TableRow><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Clinical use</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
        <TableBody>
          {versions.rows.map(version => <TableRow key={version.id}>
            <TableCell className="font-medium"><Button variant="link" className="h-auto whitespace-normal p-0 text-left" disabled={busy} onClick={() => void open(version.version)}>{version.version}</Button></TableCell>
            <TableCell><Badge variant={version.lifecycle === "APPROVED" || version.lifecycle === "ACTIVE" ? "default" : "secondary"}>{version.lifecycle.charAt(0) + version.lifecycle.slice(1).toLowerCase()}</Badge></TableCell>
            <TableCell><span className={version.clinicalUsePermitted ? "text-primary" : "text-destructive"}>{version.clinicalUsePermitted ? "Permitted" : "Prohibited"}</span></TableCell>
            <TableCell><div className="flex justify-end gap-1">{version.editable && <Button variant="ghost" size="icon" title={`Edit ${version.version}`} aria-label={`Edit ${version.version}`} onClick={() => open(version.version)}><Pencil className="size-4" /></Button>}<Button variant="ghost" size="icon" title={`Duplicate ${version.version}`} aria-label={`Duplicate ${version.version}`} disabled={busy || version.duplicable === false} onClick={() => { setSource(version); setCreating(true); }}><Copy className="size-4" /></Button>{(version.deletable ?? version.editable) && version.lifecycle === "DRAFT" && <Button variant="ghost" size="icon" className="text-destructive" title={`Delete ${version.version}`} aria-label={`Delete ${version.version}`} onClick={() => { setError(""); setDeleting(version); }}><Trash2 className="size-4" /></Button>}</div></TableCell>
          </TableRow>)}
          {versions.total === 0 && <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">{records.length ? "No rule versions match your search." : "No rule versions configured."}</TableCell></TableRow>}
        </TableBody>
      </Table></CardContent></Card>
      <Pagination aria-label="Rule versions pagination"><PaginationContent>
        <PaginationItem><Button variant="outline" size="sm" disabled={versions.page === 1} onClick={() => setPage(versions.page - 1)}>Previous</Button></PaginationItem>
        <PaginationItem><span className="flex flex-col items-center gap-1 px-2 text-xs text-muted-foreground sm:block sm:px-3 sm:text-sm" role="status"><span className="whitespace-nowrap">Page {versions.page} of {versions.pageCount}</span><span className="whitespace-nowrap"><span className="hidden sm:inline"> · </span>{versions.total} total</span></span></PaginationItem>
        <PaginationItem><Button variant="outline" size="sm" disabled={versions.page === versions.pageCount} onClick={() => setPage(versions.page + 1)}>Next</Button></PaginationItem>
      </PaginationContent></Pagination>
    </TabsContent>
  </Tabs>
  {creating && <RuleCreate {...(source ? { source } : {})} onClose={() => setCreating(false)} onCreated={record => { setCreating(false); updated(); open(record.version); }} />}
  <AlertDialog open={deleting !== null} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleting?.version}?</AlertDialogTitle><AlertDialogDescription>This permanently deletes the draft. Its activity history will be kept.</AlertDialogDescription></AlertDialogHeader><ErrorNotice error={error} /><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} className="bg-destructive" onClick={async event => { event.preventDefault(); if (!deleting) return; setBusy(true); setError(""); try { await request(`/admin/rules/${deleting.id}`, { revision: deleting.revision }, "DELETE"); setDeleting(null); updated(); } catch(cause) { setError(message(cause)); } finally { setBusy(false); } }}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
