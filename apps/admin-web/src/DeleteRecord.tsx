import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { request, message } from "./api";
import { ErrorNotice } from "./shared";
import { Button } from "./components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";

export function DeleteRecord({ kind, id, name, refresh, revision, iconOnly = false }: { kind: "clients" | "deployments"; id: string; name: string; refresh: () => Promise<void>; revision: unknown; iconOnly?: boolean }) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setAllowed(false);
    request<{ allowed: boolean }>(`/admin/${kind}/${id}/deletion`).then(result => { if (current) setAllowed(result.allowed); }).catch(() => {});
    return () => { current = false; };
  }, [kind, id, revision]);
  return <>
    {allowed && <Button type="button" variant="ghost" size={iconOnly ? "icon" : "sm"} title={`Delete ${name}`} className="text-destructive hover:text-destructive" aria-label={`Delete ${name}`} onClick={() => { setError(""); setOpen(true); }}>{iconOnly ? <Trash2 className="size-4" /> : "Delete"}</Button>}
    <AlertDialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Delete {name}?</AlertDialogTitle><AlertDialogDescription>This permanently removes this unused {kind === "clients" ? "client" : "deployment and its activation tokens"}. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
      <ErrorNotice error={error} />
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try {
          const eligibility = await request<{ allowed: boolean; reason?: string }>(`/admin/${kind}/${id}/deletion`);
          if (!eligibility.allowed) { setError(eligibility.reason ?? "This record can no longer be deleted."); return; }
          await request(`/admin/${kind}/${id}`, undefined, "DELETE");
          setAllowed(false); setOpen(false); await refresh();
        } catch (cause) { setError(message(cause)); }
        finally { setBusy(false); }
      }}>{busy ? "Deleting…" : "Delete"}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
