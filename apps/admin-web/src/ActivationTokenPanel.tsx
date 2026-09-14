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
  return <section className="space-y-4" aria-label="Activation tokens">
    <h3 className="font-medium">Activation tokens</h3>
    <TokenExpirySelect value={expiry} date={date} onValueChange={setExpiry} onDateChange={setDate} disabled={disabled || busy} />
    <Button type="button" variant="outline" disabled={busy || disabled} onClick={() => action(async () => {
      await request<ActivationToken>(`/admin/deployments/${deploymentId}/activation-token`, tokenExpiry(expiry, date)); setPage(1);
    })}>Generate token</Button>
    <p className="text-sm text-muted-foreground">A new token replaces any unused token. Connected installations keep working.</p>
    <Table><TableHeader><TableRow><TableHead>Token</TableHead><TableHead>Created</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
      <TableBody>{rows.rows.map(token => <TableRow key={token.id}>
        <TableCell className="whitespace-nowrap">Token …{token.id.slice(-6)}</TableCell>
        <TableCell className="whitespace-nowrap">{new Date(token.createdAt).toLocaleDateString()}</TableCell>
        <TableCell className="whitespace-nowrap">{token.expiresAt ? new Date(token.expiresAt).toLocaleString() : "Never"}</TableCell>
        <TableCell><Badge variant={token.status === "Unused" ? "default" : "secondary"}>{token.status}</Badge></TableCell>
        <TableCell><div className="flex gap-2">
          {token.status === "Unused" && <><Button type="button" size="sm" variant="ghost" disabled={disabled || busy || !token.canCopy} onClick={() => action(async () => {
            const result = await request<ActivationToken>(`/admin/deployments/${deploymentId}/activation-tokens/${token.id}`);
            await navigator.clipboard.writeText(result.activationToken); setCopied(token.id);
          })}>{copied === token.id ? "Copied" : "Copy"}</Button><Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => action(async () => {
            await request(`/admin/deployments/${deploymentId}/activation-tokens/${token.id}`, {}, "DELETE");
          })}>Revoke</Button></>}
        </div></TableCell>
      </TableRow>)}
      {!tokens.length && <TableRow><TableCell colSpan={5} className="h-16 text-center text-muted-foreground">{busy ? "Loading tokens…" : "No tokens yet."}</TableCell></TableRow>}
      </TableBody></Table>
    {tokens.length > 10 && <div className="flex items-center justify-center gap-3"><Button type="button" variant="outline" size="sm" disabled={rows.page === 1} onClick={() => setPage(rows.page - 1)}>Previous</Button><span className="text-sm">Page {rows.page} of {rows.pageCount}</span><Button type="button" variant="outline" size="sm" disabled={rows.page === rows.pageCount} onClick={() => setPage(rows.page + 1)}>Next</Button></div>}
    {disabled && <p className="text-sm text-muted-foreground">Save your changes before managing tokens.</p>}
    <ErrorNotice error={error} />
  </section>;
}
