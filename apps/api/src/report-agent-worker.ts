import type { ReportGenerationStore } from "./report-generation-store";
import type { ReportContentJobStore } from "./report-content-job-store";
import { REPORT_AI_ACTIVE_MODEL, ReportModelError, type ReportTextProvider, type ReportStep } from "./openrouter-report-client";

const REPORT_TERM_EXCLUSION = "Do not mention HbA1c, A1c, or glycated haemoglobin anywhere in the report, even if they appear in matched guidance. Omit those terms while retaining other supported monitoring advice. When reviewing a draft, reject any such mention.";
const STATUS_FOCUS = "Treatment-status guidance lists many possible effects. It is a menu, not a checklist to reproduce. In treatmentAdvice, briefly cover shared treatment-wide precautions and the most relevant red flags, citing all matched status IDs. Put care for a reported or confirmed symptom in effectsAdvice and do not repeat it in treatmentAdvice. Do not list conditional advice for unrelated symptoms. When nutrition-risk and treatment-status protein ranges differ, give the risk-based range as general guidance in nutritionAdvice and ask the team to reconcile the treatment-specific range; do not give both ranges as patient targets. A generic status-row caution to tailor fluids to kidney function does not establish kidney disease. Individualize fluid advice, but do not demand individualized energy or protein targets unless a matching kidney comorbidity rule is present. If a kidney comorbidity rule is present, omit numeric energy and protein ranges and ask the team to set individual fluid, energy, and protein needs. Do not tell the patient to increase fluids or aim for a fixed range. For matched kidney disease, do not instruct the patient to include, eat, or increase potassium- or magnesium-rich foods; ask the care team whether specific foods fit the individual plan. Avoid suggesting banana, coconut water, potato, spinach, or avocado as direct food examples for kidney disease; use a bland example such as toast instead unless the care team has approved the specific food. In every advice field, including symptom care, do not tell a patient with matched kidney disease to sip or drink fluids, or take ORS, unless that same sentence first makes the fluid/ORS action conditional on care-team advice.";
const REVIEWER_FOCUS = "A status row can contain many possible toxicity examples. Accept concise patient-facing treatmentAdvice when it cites each matched status row and preserves every distinct patient-relevant action, precaution, qualification, threshold and escalation. Combine overlapping meaning and replace examples with an equivalent general instruction when safe, while keeping unreported effects conditional and placing observed symptom care in effectsAdvice. A generic status-row mention of kidney function does not establish kidney disease or require individualized energy/protein targets. Without a matched kidney comorbidity rule, a high-risk energy/protein range can be presented as general guidance while fluid advice is individualized and conflicting protein targets are reconciled by the team. With matched kidney disease, flag numeric energy or protein ranges as patient advice because the team must set individual targets. Flag any direct advice to include potassium- or magnesium-rich foods, including banana, coconut water, potato, spinach, or avocado, even with a trailing qualifier; the patient should first ask whether they fit the individual plan. Flag an oral intake percentage described as a percentage of usual intake, rather than nutrition needs. Flag any report that pairs 2.3 g/day sodium with about 5 g salt; the source's 5 g salt equivalence belongs to the 2 g/day sodium statement. When matched kidney disease is present, also flag direct fluid or ORS instructions in any advice field unless the same sentence makes the action conditional on care-team advice. For reported dysphagia, flag any food texture or fluid consistency change that lacks a swallowing safety assessment or care-team direction. Flag UNCLEAR_WORDING only for a concrete ambiguity preventing the patient understanding the action. Do not treat a sourced, conditional warning as a confirmed symptom. For each issue, give a short reason naming the exact draft claim or omission and the conflicting or missing evidence. A generic reason such as 'unclear wording' is insufficient.";
export class ReportAttemptLost extends Error {}

/** Runs one specialized report step while preserving run-level usage and lease fencing. */
export function createReportAgentWorkers(options: {
  provider: ReportTextProvider;
  runStore: ReportGenerationStore;
  runId: string;
  attemptId: string;
  jobLease?: { store: ReportContentJobStore; id: string; attemptId: string };
}) {
  const { provider, runStore, runId, attemptId, jobLease } = options;
  let leaseLost = false;
  let renewing = false;
  // A report can make many sequential model calls. Renew both leases while a
  // call is in flight so another worker cannot claim the same job mid-report.
  const heartbeat = setInterval(async () => {
    if (renewing || leaseLost) return;
    renewing = true;
    try {
      if (jobLease && !await jobLease.store.renew(jobLease.id, jobLease.attemptId)) {
        leaseLost = true;
        return;
      }
      if (!await runStore.renew(runId, attemptId)) leaseLost = true;
    } catch { leaseLost = true; }
    finally { renewing = false; }
  }, 60_000);
  const assertActive = () => { if (leaseLost) throw new ReportAttemptLost(); };
  const invoke = async (step: ReportStep, system: string, user: string, schema: Record<string, unknown>): Promise<unknown> => {
    assertActive();
    const started = performance.now();
    try {
      const completion = await provider.complete({ step, system: step === "highlighter" || step === "coverage" || step === "summarizer" ? system
        : `${system} ${STATUS_FOCUS} ${step === "reviewer" ? REVIEWER_FOCUS : ""} ${REPORT_TERM_EXCLUSION}`, user, schema });
      assertActive();
      if (!await runStore.appendCall(runId, attemptId, { step, status: "SUCCEEDED", errorCode: null, ...completion.usage })) throw new ReportAttemptLost();
      return completion.content;
    } catch (error) {
      if (error instanceof ReportAttemptLost) throw error;
      if (!await runStore.appendCall(runId, attemptId, { step, status: "FAILED", model: REPORT_AI_ACTIVE_MODEL, provider: null, generationId: null,
        promptTokens: null, completionTokens: null, reasoningTokens: null, costUsd: null, latencyMs: Math.round(performance.now() - started),
        errorCode: error instanceof ReportModelError ? error.code : "MODEL_UNAVAILABLE" })) throw new ReportAttemptLost();
      throw error;
    }
  };
  return { invoke, assertActive, stop: () => clearInterval(heartbeat) };
}
