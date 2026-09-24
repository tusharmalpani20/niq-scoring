import { defaultVersionLabel } from "./deployment-version";
import { TokenExpirySelect, tokenExpiry } from "./TokenExpirySelect";
import { type ActivationToken } from "./ActivationTokenPanel";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { Overview } from "./Operations";
import { ApiError, request, message } from "./api";
import { FormInput, ErrorNotice } from "./shared";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Card, CardHeader, CardContent } from "./components/ui/card";
import { Switch } from "./components/ui/switch";
import { Field, FieldLabel, FieldError } from "./components/ui/field";
import { Select, SelectValue, SelectTrigger, SelectContent, SelectItem } from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";
import { deploymentErrors, deploymentSteps, type DeploymentValues as Values } from "./deployment-validation";
import { suggestDeploymentLabel } from "@niq-scoring/contracts";
import { deploymentDisplayLabel } from "./deployment-label";
export function DeploymentDialog({ data, deployment, initialClientId, refresh, onClose, onCreated }: { data: Overview; deployment: Overview["deployments"][number] | null; initialClientId?: string; refresh: () => Promise<void>; onClose: () => void; onCreated: (id: string) => void }) {
  const scoring = data.entitlements.find(item => item.deploymentId === deployment?.id && item.capability === "SCORING");
  const face = data.entitlements.find(item => item.deploymentId === deployment?.id && item.capability === "FACE_SCAN");
  const assignment = data.assignments.find(item => item.deploymentId === deployment?.id);
  const form = useForm<Values>({ defaultValues: {
    clientId: deployment?.clientId ?? initialClientId ?? "", environment: deployment?.environment ?? "production", label: deployment ? deploymentDisplayLabel(deployment, data.deployments) : "",
    hostingType: deployment ? (deployment.hostingType ?? "") : "NIQ_HOSTED", enabled: deployment?.enabled ?? true,
    scoringEnabled: scoring?.enabled ?? !deployment, faceEnabled: face?.enabled ?? !deployment,
    scoringUnlimited: !deployment || scoring?.monthlyLimit === null, faceUnlimited: !deployment || face?.monthlyLimit === null,
    scoringLimit: String(scoring?.monthlyLimit ?? 0), faceLimit: String(face?.monthlyLimit ?? 0),
    expiryPreset: "never", expiryDate: "",
    ruleVersion: assignment?.mode === "PINNED" ? assignment.scoringRuleVersionId ?? "" : "LATEST_APPROVED",
  } });
  const [step, setStep] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(deployment?.id ?? null);
  const createKey = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedResult, setSavedResult] = useState<{ id: string; created: boolean; activation?: ActivationToken } | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{ values: Values; body: Record<string, unknown> } | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = form.formState.isDirty;
  function close() { if (busy) return; if (pendingCreate || (!savedResult && dirty)) setConfirmClose(true); else onClose(); }
  async function refreshAfterSave(saved: { id: string; created: boolean }) {
    setBusy(true);
    setRefreshError("");
    try {
      await refresh();
    } catch (cause) {
      setRefreshError(message(cause));
      return;
    } finally {
      setBusy(false);
    }
    if (saved.created) onCreated(saved.id);
    else onClose();
  }
  async function submit(values: Values) {
    form.clearErrors();
    for (const current of [0, 1]) {
      const errors = deploymentErrors(values, current);
      if (Object.keys(errors).length) {
        for (const [name, message] of Object.entries(errors)) form.setError(name as keyof Values, { message });
        if (!savedId) setStep(current);
        requestAnimationFrame(() => document.getElementById(`deployment-${Object.keys(errors)[0]}`)?.focus());
        return;
      }
    }
    setBusy(true); setError("");
    const body = {
      clientId: values.clientId, environment: values.environment.trim(), hostingType: values.hostingType, enabled: values.enabled,
      ...(values.label.trim() ? { name: values.label.trim() } : {}),
      ...(!savedId ? { tokenExpiry: tokenExpiry(values.expiryPreset, values.expiryDate) } : {}),
      scoring: { enabled: values.scoringEnabled, monthlyLimit: values.scoringUnlimited ? null : (/^\d+$/.test(values.scoringLimit) && Number(values.scoringLimit) <= 2147483647 ? Number(values.scoringLimit) : null) },
      faceScan: { enabled: values.faceEnabled, monthlyLimit: values.faceUnlimited ? null : (/^\d+$/.test(values.faceLimit) && Number(values.faceLimit) <= 2147483647 ? Number(values.faceLimit) : null) },
      versionAssignment: values.ruleVersion === "LATEST_APPROVED" ? { mode: "LATEST_APPROVED" } : { mode: "PINNED", scoringRuleVersionId: values.ruleVersion },
    };
    const attempt = !savedId ? pendingCreate ?? { values, body } : null;
    if (attempt && !pendingCreate) setPendingCreate(attempt);
    let saved: { id: string; activation?: ActivationToken };
    try {
      saved = await request<{ id: string; activation?: ActivationToken }>(savedId ? `/admin/deployments/${savedId}/configuration` : "/admin/deployments/configuration", attempt?.body ?? body, savedId ? "PUT" : "POST", savedId ? {} : { "Idempotency-Key": createKey.current });
    } catch (cause) {
      // A definite validation rejection did not create anything; the form may be corrected.
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 &&
          !["CREATE_REQUEST_CONFLICT", "CREATE_REQUEST_DELETED"].includes(cause.code)) setPendingCreate(null);
      setError(message(cause));
      setBusy(false);
      return;
    }
    const result = { id: saved.id, created: !deployment, ...(saved.activation ? { activation: saved.activation } : {}) };
    setPendingCreate(null);
    setSavedId(saved.id);
    setSavedResult(result);
    form.reset(values);
    await refreshAfterSave(result);
  }
  function continueStep() {
    form.clearErrors();
    const errors = deploymentErrors(form.getValues(), step);
    for (const [name, message] of Object.entries(errors)) form.setError(name as keyof Values, { message });
    if (!Object.keys(errors).length) { setError(""); setStep(step + 1); }
    else requestAnimationFrame(() => document.getElementById(`deployment-${Object.keys(errors)[0]}`)?.focus());
  }
  const values = form.watch();
  const suggestedLabel = suggestDeploymentLabel(data.deployments, values.clientId, values.environment);
  const reviewRows = [
    ["Client", data.clients.find(client => client.id === values.clientId)?.name ?? ""],
    ["Deployment label", values.label.trim() || suggestedLabel],
    ["Environment", values.environment.charAt(0).toUpperCase() + values.environment.slice(1)],
    ["Hosting", values.hostingType === "NIQ_HOSTED" ? "NIQ hosted" : values.hostingType === "ON_PREMISES" ? "On-premises (legacy)" : values.hostingType === "CLIENT_CLOUD" ? "Client cloud" : "Not set"],
    ["Status", values.enabled ? "Enabled" : "Disabled"],
    ["Assessments", !values.enabled || !values.scoringEnabled ? "Disabled" : values.scoringUnlimited ? "Unlimited" : `${values.scoringLimit} / month`],
    ["Vital IQ", !values.enabled || !values.faceEnabled ? "Disabled" : values.faceUnlimited ? "Unlimited" : `${values.faceLimit} / month`],
    ["Rule", values.ruleVersion === "LATEST_APPROVED" ? defaultVersionLabel(data) : data.versions.find(version => version.id === values.ruleVersion)?.version ?? ""],
  ];
  const select = (name: "clientId" | "hostingType" | "ruleVersion" | "environment", label: string, options: Array<{ value: string; label: string }>, disabled = false) => <Controller control={form.control} name={name} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid} className="gap-2"><FieldLabel htmlFor={`deployment-${name}`}>{label}<span aria-hidden="true" className="ml-1 text-destructive">*</span></FieldLabel><Select value={field.value} onValueChange={value => { field.onChange(value); form.clearErrors(name); }} disabled={disabled || busy}><SelectTrigger ref={field.ref} onBlur={field.onBlur} id={`deployment-${name}`} aria-label={label} aria-required="true" aria-invalid={fieldState.invalid} className={fieldState.invalid ? "!border-destructive focus-visible:!border-destructive focus-visible:!ring-destructive/20" : undefined}><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>{fieldState.error && <FieldError errors={[fieldState.error]} />}</Field>} />;
  const toggle = (name: "enabled" | "scoringEnabled" | "faceEnabled" | "scoringUnlimited" | "faceUnlimited", label: string, disabled = false) => <Controller control={form.control} name={name} render={({ field }) => <div className="flex items-center justify-between gap-3"><FieldLabel htmlFor={`deployment-${name}`}>{label}</FieldLabel><Switch id={`deployment-${name}`} checked={field.value} onCheckedChange={field.onChange} disabled={busy || disabled} /></div>} />;
  const active = form.watch("enabled");
  const capabilityCard = (name: "scoring" | "face", label: string, unit: string) => {
    const enabledName = name === "scoring" ? "scoringEnabled" : "faceEnabled";
    const unlimitedName = name === "scoring" ? "scoringUnlimited" : "faceUnlimited";
    const limitName = name === "scoring" ? "scoringLimit" : "faceLimit";
    const enabled = form.watch(enabledName);
    const unlimited = form.watch(unlimitedName);
    const disabled = !active || !enabled;
    return <Card className={active ? "shadow-none" : "opacity-50 shadow-none"}>
      <CardHeader className="p-4">{toggle(enabledName, label, !active)}</CardHeader>
      <Separator />
      <CardContent className={active && !enabled ? "space-y-4 p-4 opacity-50" : "space-y-4 p-4"}>
        {toggle(unlimitedName, `Unlimited ${unit}`, disabled)}
        <p className="text-sm text-muted-foreground">{unlimited ? `No monthly limit on ${unit}.` : `Set the maximum number of ${unit} per month.`}</p>
        {!unlimited && <FormInput control={form.control} name={limitName} label={`Monthly ${unit}`} type="number" min={0} max={2147483647} step={1} showRequired required disabled={busy || disabled} />}
      </CardContent>
    </Card>;
  };
  const limits = <div className="space-y-4">
      <div className="space-y-2">{toggle("enabled", "Deployment active")}<p className="text-sm text-muted-foreground">Turn off to pause assessments and Vital IQ scans for this deployment.</p></div>
      <Separator />
      <div className="grid gap-4 sm:grid-cols-2">
        {capabilityCard("scoring", "Assessments", "assessments")}
        {capabilityCard("face", "Vital IQ", "Vital IQ scans")}
      </div>
  </div>;
  const rules = <div className="space-y-4">
      {select("ruleVersion", "Rule", [{ value: "LATEST_APPROVED", label: defaultVersionLabel(data) }, ...data.versions.filter(version => version.id === values.ruleVersion || version.clinicalUsePermitted && ["APPROVED", "ACTIVE"].includes(version.lifecycle)).map(version => ({ value: version.id, label: `${version.version} (${version.lifecycle.toLowerCase()})` }))], !active)}
      <p className="text-sm text-muted-foreground">{values.ruleVersion === "LATEST_APPROVED" ? "New assessments use the default version. If the default changes, assessments already started keep their original rules." : "This deployment stays on the selected version until you change it."}</p>
      {values.ruleVersion === "LATEST_APPROVED" && !data.versions.some(version => version.isDefault) && <p className="text-sm text-destructive">No default is set. Choose a rule or set a default in Rules before starting assessments.</p>}
  </div>;
  return <Dialog open onOpenChange={next => { if (!next) close(); }}><DialogContent aria-describedby={undefined} className="flex max-h-[90svh] flex-col overflow-hidden sm:max-w-2xl">
    <DialogHeader><DialogTitle>{savedResult ? "Deployment saved" : savedId ? "Edit deployment" : "Create deployment"}</DialogTitle></DialogHeader>
    {!savedResult && !savedId && <ol aria-label="Creation progress" className="grid grid-cols-3 gap-2 border-b pb-4">
      {deploymentSteps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={`flex items-center gap-2 text-xs sm:text-sm ${step === index ? "font-medium text-primary" : "text-muted-foreground"}`}><span className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${index <= step ? "border-primary bg-primary text-primary-foreground" : ""}`}>{index + 1}</span>{label}</li>)}
    </ol>}
    <form className="flex min-h-0 flex-col gap-4" noValidate onSubmit={event => { if (savedResult || pendingCreate) { event.preventDefault(); return; } if (!savedId && step < 2) { event.preventDefault(); continueStep(); } else void form.handleSubmit(submit)(event); }}>
      <div className="min-h-0 overflow-y-auto px-1 -mx-1 space-y-6">
      {savedResult ? <div role="status" className="space-y-3 py-2 text-sm"><p>Your deployment was saved.</p>{refreshError && <p className="text-destructive">The page could not refresh. {refreshError}</p>}{savedResult.activation && <div className="space-y-2"><label htmlFor="saved-activation-token" className="font-medium">Activation token</label><Input id="saved-activation-token" readOnly value={savedResult.activation.activationToken} onFocus={event => event.currentTarget.select()} /><p className="text-xs text-muted-foreground">Copy this token now, or retry the refresh to open the deployment’s Tokens page.</p></div>}</div> : pendingCreate ? <div role="status" className="space-y-3 py-2 text-sm"><p>The deployment request may have been saved. Retry the same request to confirm its result before creating another deployment.</p><ErrorNotice error={error} /></div> : <>
      {savedId && <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-4">{reviewRows.slice(0, 4).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium break-words">{value}</dd></div>)}</dl>
        <FormInput control={form.control} name="label" label="Deployment label" maxLength={120} disabled={busy} description="Use a name that distinguishes this deployment for the client." />
        {!deployment?.hostingType && <div className="space-y-2">{select("hostingType", "Hosting", [{ value: "NIQ_HOSTED", label: "NIQ hosted" }, { value: "CLIENT_CLOUD", label: "Client cloud" }])}<p className="text-sm text-muted-foreground">Choose hosting for this existing deployment before saving.</p></div>}
        {limits}{rules}
      </div>}
      {!savedId && step === 0 && <div className="space-y-6">
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {select("clientId", "Client", data.clients.map(client => ({ value: client.id, label: client.name })), Boolean(initialClientId))}
        {select("environment", "Environment", ["development", "test", "staging", "production"].map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })))}
      </fieldset>
      <FormInput control={form.control} name="label" label="Deployment label" placeholder={suggestedLabel} maxLength={120} disabled={busy} description={`Optional. Leave blank to use ${suggestedLabel} when saved.`} />
      {data.clients.length === 0 && <p className="text-sm text-muted-foreground">Create a client before adding a deployment.</p>}
      {select("hostingType", "Hosting", [{ value: "NIQ_HOSTED", label: "NIQ hosted" }, { value: "CLIENT_CLOUD", label: "Client cloud" }])}
      </div>}
      {!savedId && step === 1 && <div className="space-y-6">{limits}{rules}</div>}
      {!savedId && step === 2 && <div className="space-y-5">
        <dl className="divide-y rounded-xl border">{reviewRows.map(([label, value]) => <div key={label} className="grid grid-cols-2 gap-3 px-4 py-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium break-words">{value}</dd></div>)}</dl>
        <p className="text-sm text-muted-foreground">Client, environment, and hosting cannot change after creation.</p>
        <TokenExpirySelect value={form.watch("expiryPreset")} date={form.watch("expiryDate")} onValueChange={value => form.setValue("expiryPreset", value, { shouldDirty: true })} onDateChange={value => form.setValue("expiryDate", value, { shouldDirty: true })} disabled={busy} /></div>}
      <ErrorNotice error={error} />
      </>}
      </div>
      <DialogFooter className="flex shrink-0 flex-row justify-between gap-2 border-t pt-4">
        {savedResult ? <><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Close</Button><Button type="button" disabled={busy} onClick={() => void refreshAfterSave(savedResult)}>{busy ? "Refreshing…" : "Retry refresh"}</Button></> : pendingCreate ? <><Button type="button" variant="outline" disabled={busy} onClick={close}>Close</Button><Button type="button" disabled={busy} onClick={() => void submit(pendingCreate.values)}>{busy ? "Checking…" : "Retry request"}</Button></> : <><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
        <div className="flex gap-2">
          {!savedId && step > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(""); setStep(step - 1); }}>Back</Button>}
          <Button type="submit" disabled={busy || (!savedId && data.clients.length === 0)}>{busy ? "Saving…" : savedId ? "Save changes" : step < 2 ? "Continue" : "Create"}</Button>
        </div>
        </>}
      </DialogFooter>
    </form>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{pendingCreate ? "Leave this deployment request?" : "Discard deployment changes?"}</AlertDialogTitle><AlertDialogDescription>{pendingCreate ? "The request may have succeeded. If you create another deployment before checking the list, you could create a duplicate." : "Your unsaved changes will be lost."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{pendingCreate ? "Keep checking" : "Keep editing"}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{pendingCreate ? "Leave request" : "Discard"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </DialogContent></Dialog>;
}
