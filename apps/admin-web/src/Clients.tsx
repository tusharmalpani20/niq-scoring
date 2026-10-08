import { DeleteRecord } from "./DeleteRecord";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, CircleCheck, Plus, X } from "lucide-react";
import { z } from "zod";
import { clientSchema } from "./client-validation";
import { request, message } from "./api";
import { FormInput, ErrorNotice } from "./shared";
import { ListSkeleton } from "./ListSkeleton";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Tabs, TabsContent } from "./components/ui/tabs";
import { ListTab, ListTabHeader } from "./ListTabHeader";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import { Link } from "react-router-dom";
import { clientUrl } from "./record-urls";

function ClientEmptyIllustration() {
  return <svg viewBox="0 0 192 136" className="h-28 w-40" aria-hidden="true" focusable="false">
    <circle cx="96" cy="64" r="56" fill="var(--accent)" />
    <ellipse cx="96" cy="125" rx="57" ry="4" fill="var(--border)" opacity="0.5" />
    <rect x="55" y="31" width="82" height="87" rx="9" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
    <path d="M55 51h82M71 67h15v15H71zm35 0h15v15h-15zM71 92h15v15H71zm35 0h15v26h-15z" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="143" cy="36" r="18" fill="var(--primary)" />
    <path d="M143 28v16m-8-8h16" stroke="var(--primary-foreground)" strokeLinecap="round" strokeWidth="2.5" />
  </svg>;
}

type ClientRow = { id: string; name: string; enabled: boolean; deploymentCount: number };
type ClientPage = { items: ClientRow[]; total: number; page: number; pageSize: number; pageCount: number };

export function Clients() {
  const [accessClient, setAccessClient] = useState<ClientRow | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [open, setOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [result, setResult] = useState<ClientPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const form = useForm<z.infer<ReturnType<typeof clientSchema>>>({ resolver: zodResolver(clientSchema([])), defaultValues: { name: "" } });
  const { isDirty } = form.formState;
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    let current = true;
    setLoading(true); setLoadError("");
    void request<ClientPage>(`/admin/clients?page=${page}&pageSize=10&search=${encodeURIComponent(debouncedSearch)}`)
      .then(next => { if (!current) return; setResult(next); if (next.page !== page) setPage(next.page); })
      .catch(cause => { if (current) setLoadError(message(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [page, debouncedSearch, revision]);
  async function refresh() { setRevision(value => value + 1); }
  function close() { setOpen(false); setConfirmClose(false); setError(""); form.reset(); }
  function changeOpen(next: boolean) {
    if (busy) return;
    if (!next && isDirty) { setConfirmClose(true); return; }
    if (next) setOpen(true); else close();
  }
  async function create(values: z.infer<ReturnType<typeof clientSchema>>) {
    setBusy(true); setError("");
    try {
      await request("/admin/clients", values);
      // Reset immediately after creation so a refresh failure cannot duplicate the client.
      close();
      await refresh();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Tabs defaultValue="clients" className="gap-5">
    {!open && <ErrorNotice error={error} />}
    <ListTabHeader label="Client management" tabs={<ListTab value="clients" count={result?.total}>Clients</ListTab>} actions={
      <div className="flex min-w-0 items-center justify-end gap-2">
        <div className="relative w-full max-w-xs">
          <Input aria-label="Search clients" placeholder="Search clients…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="pr-9" />
          {search && <Button type="button" variant="ghost" size="icon" aria-label="Clear search" className="absolute right-0 top-0 size-9 text-muted-foreground hover:text-foreground" onClick={() => { setSearch(""); setPage(1); }}><X className="size-4" aria-hidden="true" /></Button>}
        </div>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild><Button size="icon" aria-label="Create client" title="Create client"><Plus aria-hidden="true" /></Button></DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Create client</DialogTitle></DialogHeader>
          <form noValidate onSubmit={form.handleSubmit(create)} className="form-stack">
            <FormInput control={form.control} name="name" label="Name" required maxLength={200} autoComplete="organization" />
            <ErrorNotice error={error} />
            <DialogFooter className="grid grid-cols-2 gap-2 sm:flex [&_button]:px-2 [&_button]:text-sm"><Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button><Button disabled={busy}>{busy ? "Creating…" : "Create"}</Button></DialogFooter>
          </form>
          <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Discard client details?</AlertDialogTitle><AlertDialogDescription>You have unsaved details. If you leave now, no client will be created.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={close}>Discard</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
      </div>
    } />
    <TabsContent value="clients" className="space-y-5">
    {loading ? <ListSkeleton label="clients" columns={4} /> : loadError ? <div role="alert" className="space-y-3"><ErrorNotice error={loadError} /><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Try again</Button></div> : <Card className={result?.total ? "mobile-list-card" : undefined}><CardContent className="pt-6">
      <Table className={result?.total ? "mobile-record-table client-record-table" : undefined}>
        <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Deployments</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
        <TableBody>
          {result?.items.map(client => <TableRow key={client.id}>
            <TableCell data-label="Client" className="font-medium"><Link to={clientUrl(client)} className="text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{client.name}</Link></TableCell>
            <TableCell data-label="Status"><Badge variant={client.enabled ? "success" : "inactive"}>{client.enabled ? "Enabled" : "Disabled"}</Badge></TableCell>
            <TableCell data-label="Deployments" className="text-right tabular-nums">{client.deploymentCount}</TableCell>
            <TableCell data-label="Actions" className="text-right"><div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon" title={`${client.enabled ? "Disable" : "Enable"} ${client.name}`} aria-label={`${client.enabled ? "Disable" : "Enable"} ${client.name}`} onClick={() => { setAccessError(""); setAccessClient(client); }}>
                {client.enabled ? <Ban className="size-4" aria-hidden="true" /> : <CircleCheck className="size-4 text-primary" aria-hidden="true" />}
              </Button>
              <DeleteRecord kind="clients" id={client.id} name={client.name} refresh={refresh} revision={revision} iconOnly />
            </div></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
      {result?.total === 0 && !debouncedSearch ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 py-8 text-center">
          <ClientEmptyIllustration />
          <div className="space-y-1">
            <h2 className="font-semibold">No clients yet</h2>
            <p className="text-sm text-muted-foreground">Create a client to set up its deployments.</p>
          </div>
          <Button className="mt-2" onClick={() => setOpen(true)}><Plus aria-hidden="true" /> Create client</Button>
        </div>
      ) : result?.total === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No clients match your search.</p>}
    </CardContent></Card>}
    {!!result?.total && !loadError && <Pagination aria-label="Clients pagination"><PaginationContent>
      <PaginationItem><Button variant="outline" size="sm" disabled={loading || result.page === 1} onClick={() => setPage(result.page - 1)}>Previous</Button></PaginationItem>
      <PaginationItem><span className="whitespace-nowrap px-2 text-xs text-muted-foreground sm:px-3 sm:text-sm" role="status">Page {result.page} of {result.pageCount}</span></PaginationItem>
      <PaginationItem><Button variant="outline" size="sm" disabled={loading || result.page === result.pageCount} onClick={() => setPage(result.page + 1)}>Next</Button></PaginationItem>
    </PaginationContent></Pagination>}
    </TabsContent>
    <AlertDialog open={accessClient !== null} onOpenChange={next => { if (!next && !accessBusy) setAccessClient(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{accessClient?.enabled ? "Disable" : "Enable"} {accessClient?.name}?</AlertDialogTitle>
          <AlertDialogDescription>{accessClient?.enabled ? "This will block new assessment scoring and Vital IQ scan requests across this client’s deployments. You can enable the client again later." : "This will allow requests again, subject to each deployment’s status and limits."}</AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorNotice error={accessError} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={accessBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={accessClient?.enabled ? "destructive" : "default"} disabled={accessBusy} onClick={async event => {
            event.preventDefault();
            if (!accessClient) return;
            setAccessBusy(true); setAccessError("");
            try {
              await request(`/admin/clients/${accessClient.id}/enabled`, { enabled: !accessClient.enabled }, "PATCH");
              setAccessClient(null);
              await refresh();
            } catch (cause) { setAccessError(message(cause)); setError(message(cause)); }
            finally { setAccessBusy(false); }
          }}>{accessBusy ? "Saving…" : accessClient?.enabled ? "Disable" : "Enable"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Tabs>;
}
