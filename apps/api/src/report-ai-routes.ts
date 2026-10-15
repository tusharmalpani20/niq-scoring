import type { Context, Hono } from "hono";
import { z } from "zod";
import { isFinalAssessmentDefinition, versionedRuleDefinitionSchema } from "@niq-scoring/contracts/versioned-definition";
import { initialReportAiConfig, REPORT_AI_MODEL, REPORT_AI_SCHEMA_VERSION } from "@niq-scoring/contracts/report-ai";
import { classifyScore } from "@niq-scoring/scoring-engine/versioned";
import { BindingError } from "./assessment-binding";
import { ruleChecksum } from "./rule-routes";
import type { DeploymentIdentity, ScoringStore } from "./store";
import type { ReportGenerationStore } from "./report-generation-store";
import type { ReportContentJobStore } from "./report-content-job-store";
import { buildDeterministicReportFallback, ReportFallbackError } from "./report-fallback";
import { manageReportAgents } from "./report-manager";
import { createReportAgentWorkers, ReportAttemptLost } from "./report-agent-worker";
import { REPORT_AI_ACTIVE_MODEL, ReportModelError, type ReportTextProvider } from "./openrouter-report-client";
import { eligibleClinicianToxicityOptions, matchedReportPacket, reportContentRequestSchema, reportEvidence, reportToxicityOptionsRequestSchema, validateReportFacts, validateReportSelection, type ReportContentRequest } from "./report-content";

export function installReportAiRoutes(app: Hono, options: {
  scoringStore: ScoringStore;
  runStore: ReportGenerationStore;
  jobStore: ReportContentJobStore;
  authenticate: (c: Context) => Promise<DeploymentIdentity | null>;
  provider?: ReportTextProvider;
  platformEnabled: boolean;
}) {
  const { scoringStore, runStore, jobStore, authenticate, provider, platformEnabled } = options;

  app.get("/admin/report-ai/models", c => c.json({ models: [{ id: REPORT_AI_MODEL, label: "GPT-6 Luna", provider: "OpenRouter" }] }));
  app.get("/admin/report-ai/runs", async c => {
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const clientId = c.req.query("clientId");
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
      || clientId && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(clientId)) return c.json({ error: "INVALID_REQUEST" }, 400);
    const result = await runStore.list({ page, pageSize, ...(clientId ? { clientId } : {}) });
    const overview = await scoringStore.overview();
    const clients = new Map(overview.clients.map(client => [client.id, client.name]));
    const deployments = new Map(overview.deployments.map(deployment => [deployment.id, deployment.name]));
    return c.json({ ...result, items: result.items.map(item => ({ ...item, clientName: clients.get(item.clientId) ?? "Unknown client", deploymentName: deployments.get(item.deploymentId) ?? "Unknown deployment" })) });
  });

  app.post("/v1/assessments/report-toxicity-options", async c => {
    c.header("Cache-Control", "no-store");
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    const parsed = reportToxicityOptionsRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    const input = parsed.data;
    try {
      const { binding, rule } = await scoringStore.bindAssessment({ identity, assessmentReference: input.assessmentReference, platformEnabled, create: false });
      const definition = versionedRuleDefinitionSchema.parse(rule.definition);
      if (!isFinalAssessmentDefinition(definition)) return c.json({ error: "VERSION_UNAVAILABLE" }, 409);
      const stored = await scoringStore.completedScoringResult({ identity, assessmentReference: binding.assessmentReference, resultReference: input.resultReference });
      if (!stored) return c.json({ error: "SCORING_RESULT_NOT_FOUND" }, 404);
      const result = z.object({ result: z.object({ resultReference: z.string(), assessmentReference: z.string(), bindingId: z.string(), ruleVersionId: z.string(), checksum: z.string(), score: z.number().nullable() }).passthrough() }).passthrough().safeParse(stored);
      if (!result.success || result.data.result.resultReference !== input.resultReference || result.data.result.assessmentReference !== binding.assessmentReference
        || result.data.result.bindingId !== binding.id || result.data.result.ruleVersionId !== rule.id || result.data.result.checksum !== binding.checksum) return c.json({ error: "INVALID_SCORING_RESULT" }, 409);
      if (result.data.result.score === null) return c.json({ error: "SCORE_UNAVAILABLE" }, 409);
      if (!validateReportSelection(definition, input.treatmentTypeIds, input.drugClassIds)) return c.json({ error: "INVALID_REPORT_FACTS" }, 400);
      return c.json({ assessmentReference: binding.assessmentReference, resultReference: input.resultReference,
        ruleVersionId: rule.id, checksum: binding.checksum,
        options: eligibleClinicianToxicityOptions(definition, input.treatmentTypeIds, input.drugClassIds) });
    } catch (cause) {
      if (cause instanceof BindingError) return c.json({ error: cause.code }, cause.code === "ASSESSMENT_NOT_FOUND" ? 404 : 409);
      throw cause;
    }
  });

  const generateReport = async (c: Context, identity: DeploymentIdentity, input: ReportContentRequest, allowFallback = true,
    jobLease?: { id: string; attemptId: string }, forceFallback = false): Promise<Response> => {
    if (!provider && !allowFallback) return c.json({ error: "REPORT_AI_NOT_CONFIGURED" }, 503);
    try {
      const { binding, rule } = await scoringStore.bindAssessment({ identity, assessmentReference: input.assessmentReference, platformEnabled, create: false });
      const definition = versionedRuleDefinitionSchema.parse(rule.definition);
      if (!isFinalAssessmentDefinition(definition)) return c.json({ error: "VERSION_UNAVAILABLE" }, 409);
      const aiConfig = definition.reportAi ?? initialReportAiConfig();
      if (!aiConfig.enabled) return c.json({ error: "REPORT_AI_DISABLED" }, 409);
      if (aiConfig.model !== REPORT_AI_MODEL) return c.json({ error: "REPORT_MODEL_UNAVAILABLE" }, 409);
      const stored = await scoringStore.completedScoringResult({ identity, assessmentReference: binding.assessmentReference, resultReference: input.resultReference });
      if (!stored) return c.json({ error: "SCORING_RESULT_NOT_FOUND" }, 404);
      const result = z.object({ result: z.object({ resultReference: z.string(), assessmentReference: z.string(), bindingId: z.string(), ruleVersionId: z.string(), checksum: z.string(), score: z.number().nullable() }).passthrough() }).passthrough().safeParse(stored);
      if (!result.success || result.data.result.resultReference !== input.resultReference || result.data.result.assessmentReference !== binding.assessmentReference
        || result.data.result.bindingId !== binding.id || result.data.result.ruleVersionId !== rule.id || result.data.result.checksum !== binding.checksum) return c.json({ error: "INVALID_SCORING_RESULT" }, 409);
      if (result.data.result.score !== input.facts.reviewedScore) return c.json({ error: "REVIEWED_SCORE_MISMATCH" }, 409);
      if (!validateReportFacts(definition, input.facts)) return c.json({ error: "INVALID_REPORT_FACTS" }, 400);
      const classification = classifyScore(definition, input.facts.reviewedScore);
      if (!classification) return c.json({ error: "UNMATCHED_CLASSIFICATION" }, 422);
      if (input.facts.reviewedRiskCategoryId && classification.id !== input.facts.reviewedRiskCategoryId) return c.json({ error: "RISK_CATEGORY_MISMATCH" }, 409);
      const guidance = matchedReportPacket(definition, input.facts, classification.id, input.facts.assessmentDate, await scoringStore.products.list());
      const evidence = reportEvidence(definition, input.facts, { id: classification.id, label: classification.label }, guidance);
      if (evidence.length > 500 || JSON.stringify(evidence).length > 80_000) return c.json({ error: "REPORT_CONTEXT_TOO_LARGE" }, 422);
      const promptVersion = definition.reportAi ? `rule-${rule.id}-r${rule.revision}-schema4-prompt60-manager3` : "baseline-v60-manager3";
      const legacyPromptVersion = definition.reportAi ? `rule-${rule.id}-r${rule.revision}` : "baseline-v1";
      const fingerprint = ruleChecksum({ endpoint: "report-content", assessmentReference: binding.assessmentReference, resultReference: input.resultReference,
        checksum: binding.checksum, promptVersion, facts: input.facts });
      const legacyFingerprint = ruleChecksum({ endpoint: "report-content", assessmentReference: binding.assessmentReference, resultReference: input.resultReference,
        checksum: binding.checksum, promptVersion: legacyPromptVersion, facts: input.facts });
      const reservation = await runStore.reserve({ clientId: identity.clientId, deploymentId: identity.deploymentId, assessmentReference: binding.assessmentReference,
        resultReference: input.resultReference, ruleVersionId: rule.id, checksum: binding.checksum, idempotencyKey: input.idempotencyKey,
        fingerprint, model: provider?.model ?? REPORT_AI_ACTIVE_MODEL, promptVersion, schemaVersion: REPORT_AI_SCHEMA_VERSION }, legacyFingerprint);
      if (reservation.status === "CONFLICT") return c.json({ error: "IDEMPOTENCY_CONFLICT" }, 409);
      if (reservation.status === "IN_PROGRESS") return c.json({ error: "REQUEST_IN_PROGRESS" }, 409);
      if (reservation.status === "DUPLICATE") {
        if (allowFallback && reservation.run.status === "REVIEW_REQUIRED") {
          if (forceFallback) return c.json({ error: "AUTOMATIC_REVIEW_RECOVERY_FAILED" }, 422);
          // Preserve the rejected run for audit. A separate idempotent run must
          // build and validate rule content, never relabel the rejected text.
          const recoveryKey = `auto-review:${ruleChecksum({ runId: reservation.run.id, promptVersion, facts: input.facts })}`;
          return generateReport(c, identity, { ...input, idempotencyKey: recoveryKey }, true, jobLease, true);
        }
        return c.json(reservation.run.response as never);
      }
      if (reservation.status !== "NEW") return c.json({ error: "REQUEST_IN_PROGRESS" }, 409);
      const runId = reservation.run.id;
      const attemptId = reservation.run.attemptId;
      let assertLease = () => {};
      const fallbackResponse = async () => {
        const fallback = buildDeterministicReportFallback({ facts: input.facts,
          classification: { id: classification.id, label: classification.label }, guidance, evidence });
        assertLease();
        if (jobLease && !await jobStore.renew(jobLease.id, jobLease.attemptId)) throw new ReportAttemptLost();
        const response = { runId, status: "READY" as const, assessmentReference: binding.assessmentReference,
          resultReference: input.resultReference, ruleVersionId: rule.id, checksum: binding.checksum,
          classification: { id: classification.id, label: classification.label }, model: "rule-fallback",
          promptVersion, schemaVersion: REPORT_AI_SCHEMA_VERSION, generationMode: "RULE_FALLBACK" as const,
          guidance: fallback.guidance, narrative: fallback.narrative, issues: [], omittedNarrativeFields: [] };
        if (!await runStore.finish(runId, attemptId, "READY", response)) throw new ReportAttemptLost();
        return c.json(response);
      };
      if (allowFallback && (!provider || forceFallback)) {
        try { return await fallbackResponse(); }
        catch (error) {
          if (error instanceof ReportAttemptLost) return c.json({ error: "REQUEST_IN_PROGRESS" }, 409);
          const code = error instanceof ReportFallbackError ? error.code : "REPORT_GENERATION_FAILED";
          await runStore.finish(runId, attemptId, "FAILED", null, code);
          return c.json({ error: code, runId }, 422);
        }
      }
      const { invoke, assertActive, stop } = createReportAgentWorkers({ provider: provider!, runStore, runId, attemptId,
        ...(jobLease ? { jobLease: { store: jobStore, ...jobLease } } : {}) });
      assertLease = assertActive;
      try {
        const { status, narrative: approvedNarrative, issues, omittedNarrativeFields, interventionSummaries } = await manageReportAgents({
          aiConfig, evidence, guidance, classification: { id: classification.id, label: classification.label }, invoke,
        });
        const response = { runId, status, assessmentReference: binding.assessmentReference, resultReference: input.resultReference,
          ruleVersionId: rule.id, checksum: binding.checksum, classification: { id: classification.id, label: classification.label },
          model: provider?.model ?? REPORT_AI_ACTIVE_MODEL, promptVersion, schemaVersion: REPORT_AI_SCHEMA_VERSION,
          guidance: { ...guidance, possibleToxicities: guidance.possibleToxicities.map(row => ({ ...row, summary: status === "READY" ? interventionSummaries.find(item => item.evidenceId === `possible:toxicity:${row.id}`)?.text ?? "" : "" })) }, narrative: approvedNarrative, issues,
          omittedNarrativeFields };
        assertActive();
        if (allowFallback && status === "REVIEW_REQUIRED") return await fallbackResponse();
        if (!await runStore.finish(runId, attemptId, status, response)) return c.json({ error: "REQUEST_IN_PROGRESS" }, 409);
        return c.json(response);
      } catch (error) {
        if (error instanceof ReportAttemptLost) return c.json({ error: "REQUEST_IN_PROGRESS" }, 409);
        if (allowFallback && !(error instanceof ReportFallbackError)) {
          try { return await fallbackResponse(); }
          catch (fallbackError) { error = fallbackError; }
        }
        const code = error instanceof ReportFallbackError ? error.code : error instanceof ReportModelError ? error.code : "REPORT_GENERATION_FAILED";
        if (!await runStore.finish(runId, attemptId, "FAILED", null, code)) return c.json({ error: "REQUEST_IN_PROGRESS" }, 409);
        return c.json({ error: code, runId },
          error instanceof ReportFallbackError ? 422 : error instanceof ReportModelError && error.code === "MODEL_PAYMENT_REQUIRED" ? 402 : 503);
      } finally { stop(); }
    } catch (cause) {
      if (cause instanceof BindingError) return c.json({ error: cause.code }, cause.code === "ASSESSMENT_NOT_FOUND" ? 404 : 409);
      throw cause;
    }
  };

  app.post("/v1/assessments/report-content", async c => {
    c.header("Cache-Control", "no-store");
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    const parsed = reportContentRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    return generateReport(c, identity, parsed.data);
  });

  app.post("/v1/assessments/report-content/jobs", async c => {
    c.header("Cache-Control", "no-store");
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    const parsed = reportContentRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    const fingerprint = ruleChecksum({ endpoint: "report-content-job", input: parsed.data });
    const submission = await jobStore.submit(identity, parsed.data, fingerprint);
    if (submission.status === "CONFLICT") return c.json({ error: "IDEMPOTENCY_CONFLICT" }, 409);
    return c.json({ runId: submission.job.id, status: submission.job.status }, 202);
  });

  app.get("/v1/assessments/report-content/jobs/:runId", async c => {
    c.header("Cache-Control", "no-store");
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    const job = await jobStore.get(c.req.param("runId"), identity);
    if (!job) return c.json({ error: "REPORT_JOB_NOT_FOUND" }, 404);
    return c.json({ runId: job.id, status: job.status,
      ...(job.response !== null ? { response: job.response } : {}),
      ...(job.errorCode ? { errorCode: job.errorCode } : {}) });
  });

  return async () => {
    const job = await jobStore.claim();
    if (!job || !job.attemptId) return;
    const context = { json: (value: unknown, status?: unknown) => Response.json(value, { status: typeof status === "number" ? status : 200 }) } as unknown as Context;
    try {
      const recoveringReview = job.response !== null && typeof job.response === "object"
        && (job.response as { status?: unknown }).status === "REVIEW_REQUIRED";
      const input = recoveringReview ? { ...job.input,
        idempotencyKey: `auto-review-job:${ruleChecksum({ jobId: job.id, fingerprint: job.fingerprint })}` } : job.input;
      const result = await generateReport(context, job.identity, input, true,
        { id: job.id, attemptId: job.attemptId }, recoveringReview);
      const payload = await result.json() as Record<string, unknown>;
      const status = payload.status === "READY" && Array.isArray(payload.issues) && !payload.issues.length ? "READY" : "FAILED";
      if (status === "FAILED" && (result.status >= 500 || payload.error === "REQUEST_IN_PROGRESS")) {
        await jobStore.retry(job.id, job.attemptId, String(payload.error ?? "REPORT_GENERATION_FAILED"));
        return;
      }
      await jobStore.finish(job.id, job.attemptId, status, status === "FAILED" ? null : payload,
        status === "FAILED" ? String(payload.error ?? (payload.status === "REVIEW_REQUIRED" ? "AUTOMATIC_REVIEW_RECOVERY_FAILED" : "REPORT_GENERATION_FAILED")) : undefined);
    } catch {
      await jobStore.retry(job.id, job.attemptId, "REPORT_GENERATION_FAILED");
    }
  };
}
