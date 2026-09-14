import { DeleteRecord } from "./DeleteRecord";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, CircleCheck, Plus, X } from "lucide-react";
import { z } from "zod";
import type { Overview } from "./Operations";
import { request, message } from "./api";
import { FormInput, ErrorNotice } from "./shared";
import { paginate } from "./pagination";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";

const clientSchema = z.object({ name: z.string().trim().min(2, "Enter at least 2 characters.").max(200, "Use at most 200 characters.") });
export function Clients({ data, refresh }: { data: Overview; refresh: () => Promise<void> }) {
  const [accessClient, setAccessClient] = useState<Overview["clients"][number] | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [open, setOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const form = useForm<z.infer<typeof clientSchema>>({ resolver: zodResolver(clientSchema), defaultValues: { name: "" } });
  const { isDirty } = form.formState;
  const query = search.trim().toLocaleLowerCase();
  const clients = paginate(data.clients.filter(client => client.name.toLocaleLowerCase().includes(query)), page);
  function close() { setOpen(false); setConfirmClose(false); setError(""); form.reset(); }
  function changeOpen(next: boolean) {
    if (busy) return;
    if (!next && isDirty) { setConfirmClose(true); return; }
    if (next) setOpen(true); else close();
  }
  async function create(values: z.infer<typeof clientSchema>) {
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
    <div className="flex items-center justify-between gap-3">
      <TabsList variant="line" aria-label="Client management" className="gap-2 p-0 sm:gap-5">
        <TabsTrigger value="clients" className="rounded-none border-0 px-1 shadow-none data-[state=active]:text-primary after:bg-primary">Clients <Badge variant="secondary" className="px-1.5 py-0 text-xs tabular-nums">{data.clients.length}</Badge></TabsTrigger>
      </TabsList>
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
    </div>
    <TabsContent value="clients" className="space-y-5">
    <Card><CardContent className="pt-6">
      <Table>
        <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Deployments</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
        <TableBody>
          {clients.rows.map(client => <TableRow key={client.id}>
            <TableCell className="font-medium">{client.name}</TableCell>
            <TableCell><Badge variant={client.enabled ? "default" : "secondary"}>{client.enabled ? "Enabled" : "Disabled"}</Badge></TableCell>
            <TableCell className="text-right tabular-nums">{data.deployments.filter(deployment => deployment.clientId === client.id).length}</TableCell>
            <TableCell className="text-right"><div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon" title={`${client.enabled ? "Disable" : "Enable"} ${client.name}`} aria-label={`${client.enabled ? "Disable" : "Enable"} ${client.name}`} onClick={() => { setAccessError(""); setAccessClient(client); }}>
                {client.enabled ? <Ban className="size-4" aria-hidden="true" /> : <CircleCheck className="size-4 text-primary" aria-hidden="true" />}
              </Button>
              <DeleteRecord kind="clients" id={client.id} name={client.name} refresh={refresh} revision={data} iconOnly />
            </div></TableCell>
          </TableRow>)}
          {data.clients.length === 0 && <TableRow><TableCell colSpan={4} className="h-32 text-center"><Button variant="ghost" onClick={() => setOpen(true)}><Plus aria-hidden="true" /> Create your first client</Button></TableCell></TableRow>}
          {data.clients.length > 0 && clients.total === 0 && <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">No clients match your search.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
    <Pagination aria-label="Clients pagination"><PaginationContent>
      <PaginationItem><Button variant="outline" size="sm" disabled={clients.page === 1} onClick={() => setPage(clients.page - 1)}>Previous</Button></PaginationItem>
      <PaginationItem><span className="flex flex-col items-center gap-1 px-2 text-xs text-muted-foreground sm:block sm:px-3 sm:text-sm" role="status"><span className="whitespace-nowrap">Page {clients.page} of {clients.pageCount}</span><span className="whitespace-nowrap"><span className="hidden sm:inline"> · </span>{clients.total} total</span></span></PaginationItem>
      <PaginationItem><Button variant="outline" size="sm" disabled={clients.page === clients.pageCount} onClick={() => setPage(clients.page + 1)}>Next</Button></PaginationItem>
    </PaginationContent></Pagination>
    </TabsContent>
    <AlertDialog open={accessClient !== null} onOpenChange={next => { if (!next && !accessBusy) setAccessClient(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{accessClient?.enabled ? "Disable" : "Enable"} {accessClient?.name}?</AlertDialogTitle>
          <AlertDialogDescription>{accessClient?.enabled ? "This will block new scoring and face-scan requests across this client’s deployments. You can enable the client again later." : "This will allow requests again, subject to each deployment’s status and limits."}</AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorNotice error={accessError} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={accessBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={accessBusy} onClick={async event => {
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
