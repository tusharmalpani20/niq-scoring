import { defaultVersionLabel } from "./deployment-version";
import { TokenExpirySelect, tokenExpiry } from "./TokenExpirySelect";
import { type ActivationToken } from "./ActivationTokenPanel";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { Overview } from "./Operations";
import { request, message } from "./api";
import { FormInput, ErrorNotice } from "./shared";
import { Button } from "./components/ui/button";
import { Card, CardHeader, CardContent } from "./components/ui/card";
import { Switch } from "./components/ui/switch";
import { Field, FieldLabel, FieldError } from "./components/ui/field";
import { Select, SelectValue, SelectTrigger, SelectContent, SelectItem } from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";
import { deploymentErrors, deploymentSteps, type DeploymentValues as Values } from "./deployment-validation";
export function DeploymentDialog({ data, deployment, refresh, onClose, onCreated }: { data: Overview; deployment: Overview["deployments"][number] | null; refresh: () => Promise<void>; onClose: () => void; onCreated: (id: string) => void }) {
  const scoring = data.entitlements.find(item => item.deploymentId === deployment?.id && item.capability === "SCORING");
  const face = data.entitlements.find(item => item.deploymentId === deployment?.id && item.capability === "FACE_SCAN");
  const assignment = data.assignments.find(item => item.deploymentId === deployment?.id);
  const form = useForm<Values>({ defaultValues: {
    clientId: deployment?.clientId ?? "", environment: deployment?.environment ?? "production",
    hostingType: deployment ? (deployment.hostingType ?? "") : "NIQ_HOSTED", enabled: deployment?.enabled ?? true,
    scoringEnabled: scoring?.enabled ?? !deployment, faceEnabled: face?.enabled ?? !deployment,
    scoringUnlimited: !deployment || scoring?.monthlyLimit === null, faceUnlimited: !deployment || face?.monthlyLimit === null,
    scoringLimit: String(scoring?.monthlyLimit ?? 0), faceLimit: String(face?.monthlyLimit ?? 0),
    expiryPreset: "7", expiryDate: "",
    ruleVersion: assignment?.mode === "PINNED" ? assignment.scoringRuleVersionId ?? "" : "LATEST_APPROVED",
  } });
  const [step, setStep] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(deployment?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = form.formState.isDirty;
  function close() { if (busy) return; if (dirty) setConfirmClose(true); else onClose(); }
  async function submit(values: Values) {
    form.clearErrors();
    for (const current of [0, 1]) {
      const errors = deploymentErrors(values, current);
      if (Object.keys(errors).length) {
        for (const [name, message] of Object.entries(errors)) form.setError(name as keyof Values, { message });
        if (!savedId) setStep(current);
        return;
      }
    }
    setBusy(true); setError("");
    try {
      const saved = await request<{ id: string; activation?: ActivationToken }>(savedId ? `/admin/deployments/${savedId}/configuration` : "/admin/deployments/configuration", {
        clientId: values.clientId, environment: values.environment.trim(), hostingType: values.hostingType, enabled: values.enabled,
        ...(!savedId ? { tokenExpiry: tokenExpiry(values.expiryPreset, values.expiryDate) } : {}),
        scoring: { enabled: values.scoringEnabled, monthlyLimit: values.scoringUnlimited ? null : (/^\d+$/.test(values.scoringLimit) && Number(values.scoringLimit) <= 2147483647 ? Number(values.scoringLimit) : null) },
        faceScan: { enabled: values.faceEnabled, monthlyLimit: values.faceUnlimited ? null : (/^\d+$/.test(values.faceLimit) && Number(values.faceLimit) <= 2147483647 ? Number(values.faceLimit) : null) },
        versionAssignment: values.ruleVersion === "LATEST_APPROVED" ? { mode: "LATEST_APPROVED" } : { mode: "PINNED", scoringRuleVersionId: values.ruleVersion },
      }, savedId ? "PUT" : "POST");
      setSavedId(saved.id);
      form.reset(values); await refresh();
      if (saved.activation) onCreated(saved.id); else onClose();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  function continueStep() {
    form.clearErrors();
    const errors = deploymentErrors(form.getValues(), step);
    for (const [name, message] of Object.entries(errors)) form.setError(name as keyof Values, { message });
    if (!Object.keys(errors).length) { setError(""); setStep(step + 1); }
  }
  const values = form.watch();
  const reviewRows = [
    ["Client", data.clients.find(client => client.id === values.clientId)?.name ?? ""],
    ["Environment", values.environment.charAt(0).toUpperCase() + values.environment.slice(1)],
    ["Hosting", values.hostingType === "NIQ_HOSTED" ? "NIQ hosted" : values.hostingType === "ON_PREMISES" ? "On-premises (legacy)" : values.hostingType === "CLIENT_CLOUD" ? "Client cloud" : "Not set"],
    ["Status", values.enabled ? "Enabled" : "Disabled"],
    ["Scoring", !values.enabled || !values.scoringEnabled ? "Disabled" : values.scoringUnlimited ? "Unlimited" : `${values.scoringLimit} / month`],
    ["Face scan", !values.enabled || !values.faceEnabled ? "Disabled" : values.faceUnlimited ? "Unlimited" : `${values.faceLimit} / month`],
    ["Rule version", values.ruleVersion === "LATEST_APPROVED" ? defaultVersionLabel(data) : data.versions.find(version => version.id === values.ruleVersion)?.version ?? ""],
  ];
  const select = (name: "clientId" | "hostingType" | "ruleVersion" | "environment", label: string, options: Array<{ value: string; label: string }>, disabled = false) => <Controller control={form.control} name={name} render={({ field, fieldState }) => <Field><FieldLabel htmlFor={`deployment-${name}`}>{label}</FieldLabel><Select value={field.value} onValueChange={value => { field.onChange(value); form.clearErrors(name); }} disabled={disabled || busy}><SelectTrigger ref={field.ref} onBlur={field.onBlur} id={`deployment-${name}`} aria-invalid={fieldState.invalid}><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>{fieldState.error && <FieldError errors={[fieldState.error]} />}</Field>} />;
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
        {!unlimited && <FormInput control={form.control} name={limitName} label={`Monthly ${unit}`} type="number" min={0} max={2147483647} step={1} disabled={busy || disabled} />}
      </CardContent>
    </Card>;
  };
  const limits = <div className="space-y-4">
      <div className="space-y-2">{toggle("enabled", "Deployment active")}<p className="text-sm text-muted-foreground">Turn off to pause scoring and face scans for this deployment.</p></div>
      <Separator />
      <div className="grid gap-4 sm:grid-cols-2">
        {capabilityCard("scoring", "Scoring", "scores")}
        {capabilityCard("face", "Face scan", "face scans")}
      </div>
  </div>;
  const rules = <div className="space-y-4">
      {select("ruleVersion", "Rule version", [{ value: "LATEST_APPROVED", label: defaultVersionLabel(data) }, ...data.versions.filter(version => version.id === values.ruleVersion || version.clinicalUsePermitted && ["APPROVED", "ACTIVE"].includes(version.lifecycle)).map(version => ({ value: version.id, label: `${version.version} (${version.lifecycle.toLowerCase()})` }))], !active)}
      <p className="text-sm text-muted-foreground">{values.ruleVersion === "LATEST_APPROVED" ? "New assessments use the default version. If the default changes, assessments already started keep their original rules." : "This deployment stays on the selected version until you change it."}</p>
      {values.ruleVersion === "LATEST_APPROVED" && !data.versions.some(version => version.isDefault) && <p className="text-sm text-destructive">No default is set. Choose a version or set a default in Rule versions before starting assessments.</p>}
  </div>;
  return <Dialog open onOpenChange={next => { if (!next) close(); }}><DialogContent aria-describedby={undefined} className="flex max-h-[90svh] flex-col overflow-hidden sm:max-w-2xl">
    <DialogHeader><DialogTitle>{savedId ? "Edit deployment" : "Create deployment"}</DialogTitle></DialogHeader>
    {!savedId && <ol aria-label="Creation progress" className="grid grid-cols-3 gap-2 border-b pb-4">
      {deploymentSteps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={`flex items-center gap-2 text-xs sm:text-sm ${step === index ? "font-medium text-primary" : "text-muted-foreground"}`}><span className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${index <= step ? "border-primary bg-primary text-primary-foreground" : ""}`}>{index + 1}</span>{label}</li>)}
    </ol>}
    <form className="flex min-h-0 flex-col gap-4" noValidate onSubmit={event => { if (!savedId && step < 2) { event.preventDefault(); continueStep(); } else void form.handleSubmit(submit)(event); }}>
      <div className="min-h-0 overflow-y-auto px-1 -mx-1 space-y-6">
      {savedId && <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-3">{reviewRows.slice(0, 3).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium break-words">{value}</dd></div>)}</dl>
        {!deployment?.hostingType && <div className="space-y-2">{select("hostingType", "Hosting", [{ value: "NIQ_HOSTED", label: "NIQ hosted" }, { value: "CLIENT_CLOUD", label: "Client cloud" }])}<p className="text-sm text-muted-foreground">Choose hosting for this existing deployment before saving.</p></div>}
        {limits}{rules}
      </div>}
      {!savedId && step === 0 && <div className="space-y-6">
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {select("clientId", "Client", data.clients.map(client => ({ value: client.id, label: client.name })))}
        {select("environment", "Environment", ["development", "test", "staging", "production"].map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })))}
      </fieldset>
      {data.clients.length === 0 && <p className="text-sm text-muted-foreground">Create a client before adding a deployment.</p>}
      {select("hostingType", "Hosting", [{ value: "NIQ_HOSTED", label: "NIQ hosted" }, { value: "CLIENT_CLOUD", label: "Client cloud" }])}
      </div>}
      {!savedId && step === 1 && <div className="space-y-6">{limits}{rules}</div>}
      {!savedId && step === 2 && <div className="space-y-5">
        <dl className="divide-y rounded-xl border">{reviewRows.map(([label, value]) => <div key={label} className="grid grid-cols-2 gap-3 px-4 py-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium break-words">{value}</dd></div>)}</dl>
        <p className="text-sm text-muted-foreground">Client, environment, and hosting cannot change after creation.</p>
        <TokenExpirySelect value={form.watch("expiryPreset")} date={form.watch("expiryDate")} onValueChange={value => form.setValue("expiryPreset", value, { shouldDirty: true })} onDateChange={value => form.setValue("expiryDate", value, { shouldDirty: true })} disabled={busy} /></div>}
      <ErrorNotice error={error} />
      </div>
      <DialogFooter className="flex shrink-0 flex-row justify-between gap-2 border-t pt-4">
        <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
        <div className="flex gap-2">
          {!savedId && step > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(""); setStep(step - 1); }}>Back</Button>}
          <Button type="submit" disabled={busy || (!savedId && data.clients.length === 0)}>{busy ? "Saving…" : savedId ? "Save changes" : step < 2 ? "Continue" : "Create"}</Button>
        </div>
      </DialogFooter>
    </form>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard deployment changes?</AlertDialogTitle><AlertDialogDescription>Your unsaved changes will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={onClose}>Discard</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </DialogContent></Dialog>;
}
