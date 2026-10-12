import { useEffect, useState } from "react";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { initialReportAiConfig, REPORT_AI_MODEL } from "@niq-scoring/contracts/report-ai";
import { message, request } from "../api";
import { Button } from "../components/ui/button";
import { NativeSelect } from "../components/ui/native-select";
import { Textarea } from "../components/ui/textarea";

type ModelOption = { id: string; label: string };
type Props = {
  definition: FinalAssessmentDefinition;
  disabled: boolean;
  onChange: (definition: FinalAssessmentDefinition) => void;
};

export function ReportAiEditor({ definition, disabled, onChange }: Props) {
  const config = definition.reportAi;
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void request<{ models: ModelOption[] }>("/admin/report-ai/models").then(response => {
      if (!cancelled) setModels(response.models);
    }).catch(cause => {
      if (!cancelled) setError(message(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [retry]);

  const change = (patch: Partial<NonNullable<FinalAssessmentDefinition["reportAi"]>>) => {
    if (disabled) return;
    onChange({ ...definition, reportAi: { ...(config ?? initialReportAiConfig()), ...patch } });
  };

  return <section className="min-w-0 space-y-5 rounded-2xl border border-border/50 bg-card p-5 shadow-sm sm:p-6" aria-label="Report AI configuration">
    <div className="space-y-1">
      <h2 className="text-lg font-medium">Report AI</h2>
      <p className="text-sm text-muted-foreground">Choose the wording instructions for this rule version. NIQ Scoring supplies confirmed facts and matched guidance to the writer, checks the draft, and returns text for clinician review.</p>
    </div>
    {!config && disabled ? <p className="rounded-lg border bg-muted/30 p-4 text-sm">This version predates editable Report AI settings. It uses NIQ Scoring’s built-in baseline instructions. Duplicate the version to customise them.</p> : <fieldset disabled={disabled} className="space-y-5">
      <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={config?.enabled ?? false} onChange={event => change({ enabled: event.target.checked })} />
        <span><span className="font-medium">Enable report text generation</span><span className="mt-1 block text-muted-foreground">When off, this version can still score assessments, but cannot request AI report text.</span></span>
      </label>
      <div className="max-w-md space-y-1.5 text-sm">
        <label htmlFor="report-ai-model" className="font-medium">Model</label>
        <NativeSelect id="report-ai-model" value={config?.model ?? REPORT_AI_MODEL} disabled={disabled || loading || Boolean(error)} onChange={event => {
          // The version schema and backend allowlist currently permit Luna only.
          if (event.target.value === REPORT_AI_MODEL) change({ model: REPORT_AI_MODEL });
        }}>
          {(models.length ? models : [{ id: REPORT_AI_MODEL, label: "GPT-6 Luna" }]).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
        </NativeSelect>
        {loading ? <p className="text-xs text-muted-foreground">Loading available models…</p> : error ? <div role="alert" className="flex items-center gap-2 text-xs text-destructive"><span>Could not load the model list. {error}</span><Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setRetry(value => value + 1)}>Retry</Button></div> : <p className="text-xs text-muted-foreground">The available model list is set by NIQ Scoring.</p>}
      </div>
      <label className="block space-y-1.5 text-sm" htmlFor="report-ai-writer-prompt">
        <span className="font-medium">Writer instructions</span>
        <span className="block text-muted-foreground">Describe the tone and length of the patient-facing text. Confirmed facts and matching rules are supplied separately.</span>
        <Textarea id="report-ai-writer-prompt" rows={6} maxLength={4000} value={config?.writerPrompt ?? initialReportAiConfig().writerPrompt} onChange={event => change({ writerPrompt: event.target.value })} />
        {(config?.writerPrompt.trim().length ?? 0) < 10 && <span role="alert" className="block text-xs text-destructive">Enter at least 10 characters.</span>}
      </label>
      <label className="block space-y-1.5 text-sm" htmlFor="report-ai-reviewer-prompt">
        <span className="font-medium">Reviewer instructions</span>
        <span className="block text-muted-foreground">Tell the automated reviewer what clarity or wording problems to flag before a clinician sees the draft.</span>
        <Textarea id="report-ai-reviewer-prompt" rows={6} maxLength={4000} value={config?.reviewerPrompt ?? initialReportAiConfig().reviewerPrompt} onChange={event => change({ reviewerPrompt: event.target.value })} />
        {(config?.reviewerPrompt.trim().length ?? 0) < 10 && <span role="alert" className="block text-xs text-destructive">Enter at least 10 characters.</span>}
      </label>
      <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">Safety checks, evidence limits, and report layout are fixed in NIQ Scoring. A clinician must approve the finished report in NIQ Application.</p>
    </fieldset>}
  </section>;
}
