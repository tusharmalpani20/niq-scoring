import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { request, message } from "../api";
import { ErrorNotice } from "../shared";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "../components/ui/alert-dialog";
import type { RuleDetail } from "./rule-api";
export function RuleCreate({ source, onClose, onCreated }: { source?: { id: string; version: string }; onClose: () => void; onCreated: (record: RuleDetail) => void }) {
  const [name, setName] = useState(source ? `${source.version} copy` : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const completed = useRef(false);
  const dirty = Boolean(name);
  const blocker = useBlocker(() => !completed.current && (dirty || busy));
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy]);
  const close = () => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } };
  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{source ? "Duplicate rule version" : "Create rule version"}</DialogTitle><DialogDescription>Start an editable draft. Approval is a separate action.</DialogDescription></DialogHeader>
    <form className="space-y-5" onSubmit={async event => {
      event.preventDefault(); setError("");
      if (!name.trim() || name.trim().length > 80) { setError("Enter a version name between 1 and 80 characters."); return; }
      setBusy(true);
      try {
        const record = await request<RuleDetail>("/admin/rules", { name: name.trim(), requestId, ...(source ? { duplicateId: source.id } : { template: "spreadsheet" }) });
        // Successful creation is an intentional navigation, not an unsaved exit.
        completed.current = true;
        onCreated(record);
      }
      catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>
    <fieldset disabled={busy} className="space-y-4"><div className="space-y-2"><Label htmlFor="rule-create-name">Name</Label><Input id="rule-create-name" value={name} maxLength={80} required onChange={e => setName(e.target.value)} autoFocus /></div>
      {source && <p className="text-sm text-muted-foreground">Copying {source.version}. The original version remains unchanged.</p>}</fieldset>
    <ErrorNotice error={error} /><div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Creating…" : "Create draft"}</Button></div></form>
  </DialogContent></Dialog><AlertDialog open={discard || blocker.state === "blocked"} onOpenChange={open => { setDiscard(open); if (!open && blocker.state === "blocked") blocker.reset(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard this draft setup?</AlertDialogTitle><AlertDialogDescription>Your entered details will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { if (blocker.state === "blocked") { event.preventDefault(); setDiscard(false); blocker.proceed(); } else onClose(); }}>Discard</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
