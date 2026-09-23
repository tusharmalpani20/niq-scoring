import { Plus, Copy, Check, Ban } from "lucide-react";
import { useEffect, useState } from "react";
import { request, message } from "./api";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { ErrorNotice } from "./shared";
import { TokenExpirySelect, tokenExpiry } from "./TokenExpirySelect";
import { paginate } from "./pagination";

export type ActivationToken = { activationToken: string; expiresAt: string | null };
type TokenRow = { id: string; createdAt: string; expiresAt: string | null; status: "Unused" | "Used" | "Expired" | "Revoked"; canCopy: boolean };
export function ActivationTokenPanel({ deploymentId, disabled }: { deploymentId: string; disabled: boolean }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [expiry, setExpiry] = useState("7");
  const [date, setDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
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
  async function action(run: () => Promise<void>) {
    setBusy(true); setError(""); setCopied("");
    try { await run(); await load(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  const rows = paginate(tokens, page);
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6" aria-label="Activation tokens">
    <div className="flex items-center justify-end">
      <Button type="button" disabled={busy || disabled} onClick={() => { setCreating(value => !value); setError(""); }}><Plus className="size-4" aria-hidden="true" />Create token</Button>
    </div>
    {creating && <div className="space-y-4 rounded-lg border p-4">
      <TokenExpirySelect value={expiry} date={date} onValueChange={setExpiry} onDateChange={setDate} disabled={disabled || busy} />
      <p className="text-sm text-muted-foreground">A new token replaces any unused token. Connected installations keep working.</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setCreating(false)}>Cancel</Button>
        <Button type="button" disabled={busy || disabled} onClick={() => action(async () => {
          await request<ActivationToken>(`/admin/deployments/${deploymentId}/activation-token`, tokenExpiry(expiry, date)); setPage(1); setCreating(false);
        })}>{busy ? "Creating…" : "Create"}</Button>
      </div>
    </div>}
    <div className="max-w-full overflow-x-auto"><Table className="min-w-[620px]"><TableHeader><TableRow><TableHead>Token</TableHead><TableHead>Created</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>{rows.rows.map(token => <TableRow key={token.id}>
        <TableCell className="whitespace-nowrap">NIQ …{token.id.slice(-6)}</TableCell>
        <TableCell className="whitespace-nowrap">{new Date(token.createdAt).toLocaleDateString()}</TableCell>
        <TableCell className="whitespace-nowrap">{token.expiresAt ? new Date(token.expiresAt).toLocaleString() : "Never"}</TableCell>
        <TableCell><Badge variant={token.status === "Unused" ? "default" : "secondary"}>{token.status}</Badge></TableCell>
        <TableCell><div className="flex justify-end gap-2">
          {token.status === "Unused" && <><Button type="button" size="icon" variant="ghost" title={copied === token.id ? "Copied" : "Copy token"} aria-label={copied === token.id ? "Copied" : "Copy token"} disabled={disabled || busy || !token.canCopy} onClick={() => action(async () => {
            const result = await request<ActivationToken>(`/admin/deployments/${deploymentId}/activation-tokens/${token.id}`);
            await navigator.clipboard.writeText(result.activationToken); setCopied(token.id);
          })}>{copied === token.id ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}</Button><Button type="button" size="icon" variant="ghost" className="text-destructive hover:text-destructive" title="Revoke token" aria-label="Revoke token" disabled={disabled || busy} onClick={() => action(async () => {
            await request(`/admin/deployments/${deploymentId}/activation-tokens/${token.id}`, {}, "DELETE");
          })}><Ban className="size-4" /></Button></>}
          {token.status !== "Unused" && <span className="px-3 text-muted-foreground" aria-label="No actions available">—</span>}
        </div></TableCell>
      </TableRow>)}
      {!tokens.length && <TableRow><TableCell colSpan={5} className="h-16 text-center text-muted-foreground">{busy ? "Loading tokens…" : "No tokens yet."}</TableCell></TableRow>}
      </TableBody></Table></div>
    {tokens.length > 10 && <div className="flex items-center justify-center gap-3"><Button type="button" variant="outline" size="sm" disabled={rows.page === 1} onClick={() => setPage(rows.page - 1)}>Previous</Button><span className="text-sm">Page {rows.page} of {rows.pageCount}</span><Button type="button" variant="outline" size="sm" disabled={rows.page === rows.pageCount} onClick={() => setPage(rows.page + 1)}>Next</Button></div>}
    {disabled && <p className="text-sm text-muted-foreground">Save your changes before managing tokens.</p>}
    <ErrorNotice error={error} />
  </section>;
}
