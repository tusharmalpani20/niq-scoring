import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { Overview } from "./Operations";
import { request, message } from "./api";
import { FormInput, ErrorNotice } from "./shared";
import { Button } from "./components/ui/button";
import { Switch } from "./components/ui/switch";
import { Field, FieldLabel, FieldError } from "./components/ui/field";
import { Select, SelectValue, SelectTrigger, SelectContent, SelectItem } from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";
type Values = { name: string; clientId: string; environment: string; region: string; hostingType: string; enabled: boolean; scoringEnabled: boolean; faceEnabled: boolean; scoringUnlimited: boolean; faceUnlimited: boolean; scoringLimit: string; faceLimit: string; ruleVersion: string };
export function DeploymentDialog({ data, deployment, refresh, onClose }: { data: Overview; deployment: Overview["deployments"][number] | null; refresh: () => Promise<void>; onClose: () => void }) {
  const scoring = data.entitlements.find(item => item.deploymentId === deployment?.id && item.capability === "SCORING");
  const face = data.entitlements.find(item => item.deploymentId === deployment?.id && item.capability === "FACE_SCAN");
  const assignment = data.assignments.find(item => item.deploymentId === deployment?.id);
  const form = useForm<Values>({ defaultValues: {
    name: deployment?.name ?? "", clientId: deployment?.clientId ?? "", environment: deployment?.environment ?? "production", region: deployment?.region ?? "india",
    hostingType: deployment ? (deployment.hostingType === "ON_PREMISES" ? "" : deployment.hostingType ?? "") : "NIQ_HOSTED", enabled: deployment?.enabled ?? true,
    scoringEnabled: scoring?.enabled ?? !deployment, faceEnabled: face?.enabled ?? !deployment,
    scoringUnlimited: !deployment || scoring?.monthlyLimit === null, faceUnlimited: !deployment || face?.monthlyLimit === null,
    scoringLimit: String(scoring?.monthlyLimit ?? 0), faceLimit: String(face?.monthlyLimit ?? 0),
    ruleVersion: assignment?.mode === "PINNED" ? assignment.scoringRuleVersionId ?? "" : "LATEST_APPROVED",
  } });
  const [savedId, setSavedId] = useState<string | null>(deployment?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [token, setToken] = useState<{ value: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const dirty = form.formState.isDirty;
  function close() { if (busy) return; if (dirty || (token && !copied)) setConfirmClose(true); else onClose(); }
  async function submit(values: Values) {
    form.clearErrors();
    let invalid = false;
    for (const name of ["name", "clientId", "environment", "region", "hostingType", "ruleVersion"] as const) {
      if (!values[name].trim() || ((name === "name" || name === "region") && values[name].trim().length < 2)) { form.setError(name, { message: name === "name" ? "Enter at least 2 characters." : "This field is required." }); invalid = true; }
    }
    for (const [name, unlimited] of [["scoringLimit", values.scoringUnlimited], ["faceLimit", values.faceUnlimited]] as const) {
      if ((name === "scoringLimit" ? values.scoringEnabled : values.faceEnabled) && !unlimited && (!/^\d+$/.test(values[name]) || !Number.isSafeInteger(Number(values[name])) || Number(values[name]) > 2147483647)) { form.setError(name, { message: "Enter a whole number from 0 to 2,147,483,647." }); invalid = true; }
    }
    if (invalid) return;
    setBusy(true); setError("");
    try {
      const saved = await request<{ id: string }>(savedId ? `/admin/deployments/${savedId}/configuration` : "/admin/deployments/configuration", {
        name: values.name.trim(), clientId: values.clientId, environment: values.environment.trim(), region: values.region.trim(), hostingType: values.hostingType, enabled: values.enabled,
        scoring: { enabled: values.scoringEnabled, monthlyLimit: values.scoringUnlimited ? null : (/^\d+$/.test(values.scoringLimit) && Number(values.scoringLimit) <= 2147483647 ? Number(values.scoringLimit) : null) },
        faceScan: { enabled: values.faceEnabled, monthlyLimit: values.faceUnlimited ? null : (/^\d+$/.test(values.faceLimit) && Number(values.faceLimit) <= 2147483647 ? Number(values.faceLimit) : null) },
        versionAssignment: values.ruleVersion === "LATEST_APPROVED" ? { mode: "LATEST_APPROVED" } : { mode: "PINNED", scoringRuleVersionId: values.ruleVersion },
      }, savedId ? "PUT" : "POST");
      setSavedId(saved.id);
      form.reset(values); await refresh();
      if (!token || copied) onClose();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  const select = (name: "clientId" | "hostingType" | "ruleVersion" | "environment", label: string, options: Array<{ value: string; label: string }>, disabled = false) => <Controller control={form.control} name={name} render={({ field, fieldState }) => <Field><FieldLabel htmlFor={`deployment-${name}`}>{label}</FieldLabel><Select value={field.value} onValueChange={field.onChange} disabled={disabled || busy}><SelectTrigger ref={field.ref} onBlur={field.onBlur} id={`deployment-${name}`} aria-invalid={fieldState.invalid}><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>{fieldState.error && <FieldError errors={[fieldState.error]} />}</Field>} />;
  const toggle = (name: "enabled" | "scoringEnabled" | "faceEnabled" | "scoringUnlimited" | "faceUnlimited", label: string) => <Controller control={form.control} name={name} render={({ field }) => <div className="flex items-center justify-between gap-3"><FieldLabel htmlFor={`deployment-${name}`}>{label}</FieldLabel><Switch id={`deployment-${name}`} checked={field.value} onCheckedChange={field.onChange} disabled={busy} /></div>} />;
  return <Dialog open onOpenChange={next => { if (!next) close(); }}><DialogContent aria-describedby={undefined} className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{savedId ? "Edit deployment" : "Create deployment"}</DialogTitle></DialogHeader>
    <form className="space-y-6" noValidate onSubmit={form.handleSubmit(submit)}>
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <FormInput control={form.control} name="name" label="Name" maxLength={120} />
        {select("clientId", "Client", data.clients.map(client => ({ value: client.id, label: client.name })), Boolean(savedId))}
        {select("environment", "Environment", ["development", "test", "staging", "production"].map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })))}
        <FormInput control={form.control} name="region" label="Region" maxLength={50} />
      </fieldset>
      {data.clients.length === 0 && <p className="text-sm text-muted-foreground">Create a client before adding a deployment.</p>}
      {select("hostingType", "Hosting", [{ value: "NIQ_HOSTED", label: "NIQ hosted" }, { value: "CLIENT_CLOUD", label: "Client cloud" }])}
      <div className="space-y-2">{toggle("enabled", "Deployment active")}<p className="text-sm text-muted-foreground">Turn off to pause scoring and face scans for this deployment.</p></div>
      <Separator />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-4 rounded-lg border p-4">{toggle("scoringEnabled", "Scoring")}{form.watch("scoringEnabled") && <>{toggle("scoringUnlimited", "Unlimited scores")}<p className="text-sm text-muted-foreground">{form.watch("scoringUnlimited") ? "No monthly limit on scores." : "Set the maximum number of scores per month."}</p>{!form.watch("scoringUnlimited") && <FormInput control={form.control} name="scoringLimit" label="Monthly scores" type="number" min={0} max={2147483647} step={1} disabled={busy} />}</>}</div>
        <div className="space-y-4 rounded-lg border p-4">{toggle("faceEnabled", "Face scan")}{form.watch("faceEnabled") && <>{toggle("faceUnlimited", "Unlimited face scans")}<p className="text-sm text-muted-foreground">{form.watch("faceUnlimited") ? "No monthly limit on face scans." : "Set the maximum number of face scans per month."}</p>{!form.watch("faceUnlimited") && <FormInput control={form.control} name="faceLimit" label="Monthly face scans" type="number" min={0} max={2147483647} step={1} disabled={busy} />}</>}</div>
      </div>
      {select("ruleVersion", "Rule version", [{ value: "LATEST_APPROVED", label: "Latest approved" }, ...data.versions.map(version => ({ value: version.id, label: `${version.version} (${version.lifecycle.toLowerCase()})` }))])}
      {savedId && <><Separator /><div className="space-y-2"><FieldLabel>Activation token</FieldLabel>{!token ? <Button type="button" variant="outline" disabled={busy || dirty} onClick={async () => { setBusy(true); setError(""); try { const result = await request<{ activationToken: string; expiresAt: string }>(`/admin/deployments/${savedId}/activation-token`, { expiresInMinutes: 30 }); setToken({ value: result.activationToken, expiresAt: result.expiresAt }); setCopied(false); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }}>Generate token</Button> : <><Button type="button" variant="link" className="h-auto p-0" onClick={async () => { try { await navigator.clipboard.writeText(token.value); setCopied(true); setError(""); } catch { setError("Could not copy the token. Please allow clipboard access and try again."); } }}>{copied ? "Copied · Copy again" : "Copy activation token"}</Button><p className="text-sm text-muted-foreground">Expires {new Date(token.expiresAt).toLocaleString()}.</p></>}{dirty && <p className="text-sm text-muted-foreground">Save your changes before generating a token.</p>}</div></>}
      <ErrorNotice error={error} />
      <DialogFooter className="grid grid-cols-2 gap-2 sm:flex"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy || data.clients.length === 0}>{busy ? "Saving…" : savedId ? "Save" : "Create"}</Button></DialogFooter>
    </form>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave this deployment?</AlertDialogTitle><AlertDialogDescription>{dirty && "Your unsaved changes will be lost. "}{token && !copied && "You have not copied the activation token. It cannot be retrieved after closing."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={onClose}>Leave</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </DialogContent></Dialog>;
}
