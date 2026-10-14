import type { ReportGenerationStore } from "./report-generation-store";
import type { ReportContentJobStore } from "./report-content-job-store";
import { REPORT_AI_ACTIVE_MODEL, ReportModelError, type ReportTextProvider, type ReportStep } from "./openrouter-report-client";

const REPORT_TERM_EXCLUSION = "Do not mention HbA1c, A1c, or glycated haemoglobin anywhere in the report. Omit those terms while retaining supported monitoring advice.";
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
      const completion = await provider.complete({ step, system: `${system} ${REPORT_TERM_EXCLUSION}`, user, schema });
      assertActive();
      if (!await runStore.appendCall(runId, attemptId, { step, status: "SUCCEEDED", errorCode: null, ...completion.usage })) throw new ReportAttemptLost();
      return completion.content;
    } catch (error) {
      if (error instanceof ReportAttemptLost) throw error;
      if (!await runStore.appendCall(runId, attemptId, { step, status: "FAILED", model: provider.modelForStep?.(step) ?? provider.model ?? REPORT_AI_ACTIVE_MODEL, provider: provider.provider ?? null, generationId: null,
        promptTokens: null, completionTokens: null, reasoningTokens: null, costUsd: null, latencyMs: Math.round(performance.now() - started),
        ...(error instanceof ReportModelError && error.usage ? error.usage : {}),
        errorCode: error instanceof ReportModelError ? error.code : "MODEL_UNAVAILABLE" })) throw new ReportAttemptLost();
      throw error;
    }
  };
  return { invoke, assertActive, stop: () => clearInterval(heartbeat) };
}
