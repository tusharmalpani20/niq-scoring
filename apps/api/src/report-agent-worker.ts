import type { ReportTraceStore } from "./report-trace-store";
import type { ReportGenerationStore } from "./report-generation-store";
import type { ReportContentJobStore } from "./report-content-job-store";
import { REPORT_AI_ACTIVE_MODEL, ReportModelError, type ReportTextProvider, type ReportStep } from "./openrouter-report-client";

const REPORT_TERM_EXCLUSION = "Do not mention HbA1c, A1c, or glycated haemoglobin anywhere in the report. Omit those terms while retaining supported monitoring advice.";
export class ReportAttemptLost extends Error {}
export class ReportTraceError extends Error {
  readonly code = "REPORT_TRACE_UNAVAILABLE";
  constructor() { super("REPORT_TRACE_UNAVAILABLE"); }
}

/** Runs one specialized report step while preserving run-level usage and lease fencing. */
export function createReportAgentWorkers(options: {
  provider: ReportTextProvider;
  runStore: ReportGenerationStore;
  traceStore: ReportTraceStore;
  runId: string;
  attemptId: string;
  jobLease?: { store: ReportContentJobStore; id: string; attemptId: string };
}) {
  const { provider, runStore, traceStore, runId, attemptId, jobLease } = options;
  let sequence = 0;
  let traceUnavailable = false;
  const traceFailure = () => { traceUnavailable = true; return new ReportTraceError(); };
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
  const assertActive = () => {
    if (traceUnavailable) throw new ReportTraceError();
    if (leaseLost) throw new ReportAttemptLost();
  };
  const invoke = async (step: ReportStep, system: string, user: string, schema: Record<string, unknown>): Promise<unknown> => {
    assertActive();
    const input = { sequence: ++sequence, step, system: `${system} ${REPORT_TERM_EXCLUSION}`, user, schema };
    // Persist the exact request before inference; a crashed call remains visibly pending.
    let callId: string | null;
    try { callId = await traceStore.beginCall(runId, attemptId, input); }
    catch { throw traceFailure(); }
    if (!callId) throw new ReportAttemptLost();
    const persist = async (outcome: Parameters<ReportTraceStore["completeCall"]>[3]) => {
      let saved: boolean;
      try { saved = await traceStore.completeCall(runId, attemptId, callId!, outcome); }
      catch { throw traceFailure(); }
      if (!saved) throw new ReportAttemptLost();
    };
    const started = performance.now();
    let observedAttempts = 0;
    const providerAttempts: unknown[] = [];
    let completion;
    try {
      completion = await provider.complete({ step, system: input.system, user, schema, beforeAttempt: async () => {
        assertActive();
        // Recheck durable ownership before each paid retry, not only on the
        // heartbeat or after a response has already consumed inference.
        try {
          if (jobLease && !await jobLease.store.renew(jobLease.id, jobLease.attemptId)) leaseLost = true;
          if (!leaseLost && !await runStore.renew(runId, attemptId)) leaseLost = true;
        } catch { throw traceFailure(); }
        assertActive();
      }, onAttempt: async outcome => {
        assertActive();
        // Record actual upstream requests, including failed/retried billed output.
        // No raw response, refusal text, credentials or prompts enter usage events.
        let saved: boolean;
        try { saved = await traceStore.appendEvent(runId, attemptId, {
          stage: "provider_attempt", payload: { sequence: input.sequence, step, ...outcome },
        }); } catch { throw traceFailure(); }
        if (!saved) { leaseLost = true; throw new ReportAttemptLost(); }
        try { saved = await runStore.appendCall(runId, attemptId, { step, status: outcome.errorCode ? "FAILED" : "SUCCEEDED",
          errorCode: outcome.errorCode, ...outcome.usage }); }
        catch { throw traceFailure(); }
        if (!saved) { leaseLost = true; throw new ReportAttemptLost(); }
        observedAttempts++;
        providerAttempts.push(outcome);
      } });
      completion = { ...completion, content: await completion.content };
    } catch (error) {
      assertActive();
      const code = error instanceof ReportModelError ? error.code : "MODEL_UNAVAILABLE";
      // Arbitrary upstream exception messages may contain credentials or response bodies.
      if (error instanceof ReportAttemptLost || error instanceof ReportTraceError) throw error;
      await persist({ errorCode: code, ...(error instanceof ReportModelError && error.usage ? {
        usage: { ...error.usage, ...(observedAttempts ? { providerAttempts } : {}) },
      } : {}) });
      if (!observedAttempts && !await runStore.appendCall(runId, attemptId, { step, status: "FAILED", model: provider.modelForStep?.(step) ?? provider.model ?? REPORT_AI_ACTIVE_MODEL, provider: provider.provider ?? null, generationId: null,
        promptTokens: null, completionTokens: null, reasoningTokens: null, costUsd: null, latencyMs: Math.round(performance.now() - started),
        ...(error instanceof ReportModelError && error.usage ? error.usage : {}), errorCode: code })) throw new ReportAttemptLost();
      throw error;
    }
    assertActive();
    await persist({ response: completion.content, usage: { ...completion.usage, ...(observedAttempts ? { providerAttempts } : {}) } });
    if (!observedAttempts && !await runStore.appendCall(runId, attemptId, { step, status: "SUCCEEDED", errorCode: null, ...completion.usage })) throw new ReportAttemptLost();
    return completion.content;
  };
  return { invoke, assertActive, stop: () => clearInterval(heartbeat) };
}
