import { useEffect, useState } from "react";
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
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const dirty = Boolean(name) || step > 1;
  const blocker = useBlocker(dirty || busy);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy]);
  const close = () => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } };
  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{source ? "Duplicate rule version" : "Create rule version"}</DialogTitle><DialogDescription>Start an editable draft. Approval is a separate action.</DialogDescription></DialogHeader>
    <ol className="flex gap-6 border-b pb-4 text-sm" aria-label="Creation steps"><li aria-current={step === 1 ? "step" : undefined} className={step === 1 ? "font-medium text-primary" : "text-muted-foreground"}>1 · Details</li><li aria-current={step === 2 ? "step" : undefined} className={step === 2 ? "font-medium text-primary" : "text-muted-foreground"}>2 · Review</li></ol>
    <form className="space-y-5" onSubmit={async event => {
      event.preventDefault(); setError("");
      if (!name.trim() || name.trim().length > 80) { setError("Enter a version name between 1 and 80 characters."); return; }
      if (step === 1) { setStep(2); return; }
      setBusy(true);
      try { onCreated(await request<RuleDetail>("/admin/rules", { name: name.trim(), requestId, ...(source ? { duplicateId: source.id } : { template: "spreadsheet" }) })); }
      catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }}>
    {step === 1 ? <fieldset disabled={busy} className="space-y-4"><div className="space-y-2"><Label htmlFor="rule-create-name">Version name</Label><Input id="rule-create-name" value={name} maxLength={80} required onChange={e => setName(e.target.value)} autoFocus /></div>
      {source && <p className="text-sm text-muted-foreground">Copying {source.version}. The original version remains unchanged.</p>}</fieldset> : <dl className="space-y-4"><div><dt className="text-sm text-muted-foreground">Version name</dt><dd className="font-medium break-words">{name.trim()}</dd></div><div><dt className="text-sm text-muted-foreground">Starting point</dt><dd>{source ? source.version : "NIQ assessment spreadsheet"}</dd></div><div><dt className="text-sm text-muted-foreground">Initial status</dt><dd>Draft · clinical use prohibited</dd></div></dl>}
    <ErrorNotice error={error} /><div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={step === 2 ? () => setStep(1) : close}>{step === 2 ? "Back" : "Cancel"}</Button><Button disabled={busy}>{busy ? "Creating…" : step === 1 ? "Continue" : "Create draft"}</Button></div></form>
  </DialogContent></Dialog><AlertDialog open={discard || blocker.state === "blocked"} onOpenChange={open => { setDiscard(open); if (!open && blocker.state === "blocked") blocker.reset(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard this draft setup?</AlertDialogTitle><AlertDialogDescription>Your entered details will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { if (blocker.state === "blocked") { event.preventDefault(); setDiscard(false); blocker.proceed(); } else onClose(); }}>Discard</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
