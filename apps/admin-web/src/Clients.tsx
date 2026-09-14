import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { z } from "zod";
import type { Overview } from "./Operations";
import { request, message } from "./api";
import { FormInput, ErrorNotice } from "./shared";
import { paginate } from "./pagination";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";

const clientSchema = z.object({ name: z.string().trim().min(2, "Enter at least 2 characters.").max(200, "Use at most 200 characters.") });
export function Clients({ data, refresh }: { data: Overview; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const form = useForm<z.infer<typeof clientSchema>>({ resolver: zodResolver(clientSchema), defaultValues: { name: "" } });
  const { isDirty } = form.formState;
  const clients = paginate(data.clients, page);
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
  return <>
    {!open && <ErrorNotice error={error} />}
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{clients.total} {clients.total === 1 ? "client" : "clients"}</span>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild><Button size="icon" aria-label="Create client" title="Create client"><Plus aria-hidden="true" /></Button></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Create client</DialogTitle><DialogDescription>Add your client’s name. You can set up their deployments next.</DialogDescription></DialogHeader>
          <form noValidate onSubmit={form.handleSubmit(create)} className="form-stack">
            <FormInput control={form.control} name="name" label="Client name" required maxLength={200} autoComplete="organization" />
            <ErrorNotice error={error} />
            <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button><Button disabled={busy}>{busy ? "Creating…" : "Create client"}</Button></DialogFooter>
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
    <Card><CardContent className="pt-6">
      <Table>
        <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Deployments</TableHead></TableRow></TableHeader>
        <TableBody>
          {clients.rows.map(client => <TableRow key={client.id}>
            <TableCell className="font-medium">{client.name}</TableCell>
            <TableCell><Badge variant={client.enabled ? "default" : "secondary"}>{client.enabled ? "Enabled" : "Disabled"}</Badge></TableCell>
            <TableCell className="text-right tabular-nums">{data.deployments.filter(deployment => deployment.clientId === client.id).length}</TableCell>
          </TableRow>)}
          {clients.total === 0 && <TableRow><TableCell colSpan={3} className="h-32 text-center"><Button variant="ghost" onClick={() => setOpen(true)}><Plus aria-hidden="true" /> Create your first client</Button></TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
    {clients.total > 0 && <Pagination aria-label="Clients pagination"><PaginationContent>
      <PaginationItem><Button variant="outline" size="sm" disabled={clients.page === 1} onClick={() => setPage(clients.page - 1)}>Previous</Button></PaginationItem>
      <PaginationItem><span className="px-3 text-sm text-muted-foreground" role="status">Page {clients.page} of {clients.pageCount}</span></PaginationItem>
      <PaginationItem><Button variant="outline" size="sm" disabled={clients.page === clients.pageCount} onClick={() => setPage(clients.page + 1)}>Next</Button></PaginationItem>
    </PaginationContent></Pagination>}
  </>;
}
