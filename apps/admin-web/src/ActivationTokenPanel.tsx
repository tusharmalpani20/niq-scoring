import { Copy, Check, Ban } from "lucide-react";
import { useEffect, useState } from "react";
import { request, message } from "./api";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { ErrorNotice } from "./shared";
import { TokenExpirySelect, tokenExpiry } from "./TokenExpirySelect";
import { paginate } from "./pagination";

export type ActivationToken = { activationToken: string; expiresAt: string | null };
type TokenRow = { id: string; createdAt: string; expiresAt: string | null; status: "Unused" | "Used" | "Expired" | "Revoked"; canCopy: boolean; credentialStatus: "Active" | "Revoked" | "Expired" | null };
const statusColors: Record<TokenRow["status"], string> = {
  Unused: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  Used: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
  Expired: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  Revoked: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
};
export function ActivationTokenPanel({ deploymentId, disabled, creating, onCreatingChange }: { deploymentId: string; disabled: boolean; creating: boolean; onCreatingChange: (creating: boolean) => void }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [expiry, setExpiry] = useState("7");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [revokeTarget, setRevokeTarget] = useState<TokenRow | null>(null);
  async function load() {
    const result = await request<{ tokens: TokenRow[] }>(`/admin/deployments/${deploymentId}/activation-tokens`);
    setTokens(result.tokens);
  }
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    request<{ tokens: TokenRow[] }>(`/admin/deployments/${deploymentId}/activation-tokens`)
      .then(result => { if (!cancelled) setTokens(result.tokens); })
      .catch(cause => { if (!cancelled) setError(message(cause)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [deploymentId]);
  async function action(run: () => Promise<void>): Promise<boolean> {
    setBusy(true); setError(""); setCopied("");
    try { await run(); await load(); return true; } catch (cause) { setError(message(cause)); return false; } finally { setBusy(false); }
  }
  async function revokeAccess(token: TokenRow) {
    setBusy(true); setError("");
    try {
      await request(`/admin/deployments/${deploymentId}/activation-tokens/${token.id}/credential`, {}, "DELETE");
      setTokens(current => current.map(row => row.id === token.id ? { ...row, credentialStatus: "Revoked" } : row));
      setRevokeTarget(null);
      try { await load(); }
      catch { setError("Access was revoked, but the token list could not be refreshed. Reload the page to see the latest status."); }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  const rows = paginate(tokens, page);
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6" aria-label="Activation tokens">
    {creating && <div className="space-y-4 rounded-lg border p-4">
      <TokenExpirySelect value={expiry} date={date} onValueChange={setExpiry} onDateChange={setDate} disabled={disabled || busy} />
      <p className="text-sm text-muted-foreground">A new token replaces any unused token. Connected installations keep working.</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => onCreatingChange(false)}>Cancel</Button>
        <Button type="button" disabled={busy || disabled} onClick={() => action(async () => {
          await request<ActivationToken>(`/admin/deployments/${deploymentId}/activation-token`, tokenExpiry(expiry, date)); setPage(1); onCreatingChange(false);
        })}>{busy ? "Creating…" : "Create"}</Button>
      </div>
    </div>}
    <Table className="min-w-[620px]"><TableHeader><TableRow><TableHead>Token</TableHead><TableHead>Created</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>{rows.rows.map(token => <TableRow key={token.id}>
        <TableCell className="py-3.5 font-medium">NIQ …{token.id.slice(-6)}</TableCell>
        <TableCell className="py-3.5">{new Date(token.createdAt).toLocaleDateString()}</TableCell>
        <TableCell className="py-3.5">{token.expiresAt ? new Date(token.expiresAt).toLocaleString() : "Never"}</TableCell>
        <TableCell className="py-3.5"><div className="flex flex-col items-start gap-1"><Badge variant="outline" className={statusColors[token.status]}>{token.status}</Badge>{token.status === "Used" && <span className="text-xs text-muted-foreground">{token.credentialStatus === "Active" ? "Credential active" : token.credentialStatus === "Revoked" ? "Credential revoked" : token.credentialStatus === "Expired" ? "Credential expired" : "Credential link unavailable"}</span>}</div></TableCell>
        <TableCell className="py-3.5"><div className="flex justify-end gap-2">
          {token.status === "Unused" && <><Button type="button" size="icon" variant="ghost" title={copied === token.id ? "Copied" : "Copy token"} aria-label={copied === token.id ? "Copied" : "Copy token"} disabled={disabled || busy || !token.canCopy} onClick={() => action(async () => {
            const result = await request<ActivationToken>(`/admin/deployments/${deploymentId}/activation-tokens/${token.id}`);
            await navigator.clipboard.writeText(result.activationToken); setCopied(token.id);
          })}>{copied === token.id ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}</Button><Button type="button" size="icon" variant="ghost" className="text-destructive hover:text-destructive" title="Revoke token" aria-label="Revoke token" disabled={disabled || busy} onClick={() => action(async () => {
            await request(`/admin/deployments/${deploymentId}/activation-tokens/${token.id}`, {}, "DELETE");
          })}><Ban className="size-4" /></Button></>}
          {token.status === "Used" && token.credentialStatus === "Active" && <Button type="button" size="icon" variant="ghost" className="text-destructive hover:text-destructive" title="Revoke installation access" aria-label={`Revoke access for token NIQ …${token.id.slice(-6)}`} disabled={disabled || busy} onClick={() => { setError(""); setRevokeTarget(token); }}><Ban className="size-4" /></Button>}
          {token.status !== "Unused" && token.credentialStatus !== "Active" && <span className="px-3 text-muted-foreground" aria-label="No actions available">—</span>}
        </div></TableCell>
      </TableRow>)}
      {!tokens.length && <TableRow><TableCell colSpan={5} className="h-16 text-center text-muted-foreground">{busy ? "Loading tokens…" : "No tokens yet."}</TableCell></TableRow>}
      </TableBody></Table>
    {rows.rows.some(token => token.status === "Used" && !token.credentialStatus) && <p className="text-sm text-muted-foreground">Older used tokens cannot be linked to a credential automatically. Revoke access from a linked active token row, or disable the deployment to block all installations.</p>}
    {tokens.length > 10 && <div className="flex items-center justify-center gap-3"><Button type="button" variant="outline" size="sm" disabled={rows.page === 1} onClick={() => setPage(rows.page - 1)}>Previous</Button><span className="text-sm">Page {rows.page} of {rows.pageCount}</span><Button type="button" variant="outline" size="sm" disabled={rows.page === rows.pageCount} onClick={() => setPage(rows.page + 1)}>Next</Button></div>}
    {disabled && <p className="text-sm text-muted-foreground">Save your changes before managing tokens.</p>}
    {!revokeTarget && <ErrorNotice error={error} />}
    <AlertDialog open={revokeTarget !== null} onOpenChange={open => { if (!open && !busy) setRevokeTarget(null); }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Revoke this installation’s access?</AlertDialogTitle><AlertDialogDescription>Future requests using the credential issued by token NIQ …{revokeTarget?.id.slice(-6)} will be rejected. Other credentials remain active. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
      <ErrorNotice error={error} />
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} className="bg-destructive text-white hover:bg-destructive/90" onClick={event => { event.preventDefault(); if (revokeTarget) void revokeAccess(revokeTarget); }}>{busy ? "Revoking…" : "Revoke access"}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </section>;
}
