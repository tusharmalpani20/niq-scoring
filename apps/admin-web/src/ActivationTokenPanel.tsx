import { useEffect, useState } from "react";
import { request, message } from "./api";
import { Button } from "./components/ui/button";
import { FieldLabel } from "./components/ui/field";
import { ErrorNotice } from "./shared";

export type ActivationToken = { activationToken: string; expiresAt: string };
export function ActivationTokenPanel({ deploymentId, initialToken, disabled }: { deploymentId: string; initialToken: ActivationToken | null; disabled: boolean }) {
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    request<{ activation: ActivationToken | null }>(`/admin/deployments/${deploymentId}/activation-token`)
      .then(result => { if (!cancelled) setToken(result.activation); })
      .catch(cause => { if (!cancelled) setError(message(cause)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [deploymentId]);
  async function copy() {
    setBusy(true); setError(""); setCopied(false);
    try {
      // Recheck validity so consumed or replaced tokens are never copied from stale state.
      const result = await request<{ activation: ActivationToken | null }>(`/admin/deployments/${deploymentId}/activation-token`);
      setToken(result.activation);
      if (!result.activation) { setError("This token is no longer available. Generate a new one."); return; }
      await navigator.clipboard.writeText(result.activation.activationToken);
      setCopied(true);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function generate() {
    setBusy(true); setError(""); setCopied(false);
    try { setToken(await request<ActivationToken>(`/admin/deployments/${deploymentId}/activation-token`, { expiresInMinutes: 30 })); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <FieldLabel>Activation token</FieldLabel>
    <div className="flex flex-wrap items-center gap-4">
      {token && <Button type="button" variant="link" className="h-auto p-0" disabled={busy || disabled} onClick={copy}>{copied ? "Copied · Copy again" : "Copy token"}</Button>}
      <Button type="button" variant="outline" disabled={busy || disabled} onClick={generate}>{token ? "Generate new token" : "Generate token"}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{token ? `Expires ${new Date(token.expiresAt).toLocaleString()}. You can copy it again until it expires or is used.` : "No unused token is available."}</p>
    <p className="text-sm text-muted-foreground">A new token replaces any unused token. Connected installations keep working.</p>
    {disabled && <p className="text-sm text-muted-foreground">Save your changes before managing the token.</p>}
    <ErrorNotice error={error} />
  </div>;
}
