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
  const [nameError, setNameError] = useState("");
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
  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{source ? "Duplicate rule" : "Create rule"}</DialogTitle><DialogDescription>{source ? "Copy the scoring rules into a new draft you can edit." : "Name your draft to start editing the scoring rules."}</DialogDescription></DialogHeader>
    <form className="space-y-5" noValidate onSubmit={async event => {
      event.preventDefault(); setError(""); setNameError("");
      if (!name.trim() || name.trim().length > 80) { setNameError("Enter a rule name between 1 and 80 characters."); return; }
      setBusy(true);
      try {
        const record = await request<RuleDetail>("/admin/rules", { name: name.trim(), requestId, ...(source ? { duplicateId: source.id } : { template: "final_assessment" }) });
        // Successful creation is an intentional navigation, not an unsaved exit.
        completed.current = true;
        onCreated(record);
      }
      catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>
    <fieldset disabled={busy} className="space-y-4"><div className="space-y-2"><Label htmlFor="rule-create-name">Name<span aria-hidden="true" className="ml-1 text-destructive">*</span></Label><Input id="rule-create-name" aria-label="Name" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "rule-create-name-error" : undefined} className={nameError ? "border-destructive" : undefined} value={name} maxLength={80} required onChange={e => { setName(e.target.value); setNameError(""); }} autoFocus />{nameError && <p id="rule-create-name-error" className="text-sm text-destructive">{nameError}</p>}</div>
      {source && <p className="text-sm text-muted-foreground">Copying {source.version}. The original rule remains unchanged.</p>}</fieldset>
    <ErrorNotice error={error} /><div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Creating…" : "Create draft"}</Button></div></form>
  </DialogContent></Dialog><AlertDialog open={discard || blocker.state === "blocked"} onOpenChange={open => { setDiscard(open); if (!open && blocker.state === "blocked") blocker.reset(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard entered details?</AlertDialogTitle><AlertDialogDescription>The details you entered will not be saved.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { if (blocker.state === "blocked") { event.preventDefault(); setDiscard(false); blocker.proceed(); } else onClose(); }}>Discard</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
