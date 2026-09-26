import type { Context, Hono } from "hono";
import { z } from "zod";
import { answersSchema } from "@niq-scoring/contracts/rules";
import { isFinalAssessmentDefinition, versionedRuleDefinitionSchema } from "@niq-scoring/contracts/versioned-definition";
import { publicQuestionnaire } from "@niq-scoring/contracts/rule-public";
import { classifyScore, evaluateVersionedRule } from "@niq-scoring/scoring-engine/versioned";
import { BindingError } from "./assessment-binding";
import { ruleChecksum } from "./rule-routes";
import type { DeploymentIdentity, ScoringStore } from "./store";
const reference = z.string().trim().min(1).max(128);
const publicRiskCategories = (definition: Extract<z.infer<typeof versionedRuleDefinitionSchema>, { profile: "NIQ_FINAL_ASSESSMENT" }>) =>
  definition.riskCategories.map(({ id, label, color, min, max, minInclusive, maxInclusive }) => ({ id, label, color, min, max, minInclusive, maxInclusive }));
export function installAssessmentRoutes(app: Hono, store: ScoringStore, authenticate: (c: Context) => Promise<DeploymentIdentity | null>, now: () => Date, platformEnabled: boolean) {
  app.post("/v1/assessments/risk-categories", async c => {
    c.header("Cache-Control", "no-store");
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    const parsed = z.object({ assessmentReference: reference }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    try {
      // Only an existing binding may be read: historical ranges must come from its pinned version.
      const { binding, rule } = await store.bindAssessment({ identity, assessmentReference: parsed.data.assessmentReference, platformEnabled, create: false });
      const definition = versionedRuleDefinitionSchema.parse(rule.definition);
      if (!isFinalAssessmentDefinition(definition)) return c.json({ error: "VERSION_UNAVAILABLE" }, 409);
      return c.json({ assessmentReference: binding.assessmentReference, bindingId: binding.id, ruleVersionId: rule.id, checksum: binding.checksum, version: rule.version, riskCategories: publicRiskCategories(definition) });
    } catch (cause) {
      if (cause instanceof BindingError) return c.json({ error: cause.code }, cause.code === "ASSESSMENT_NOT_FOUND" ? 404 : 409);
      throw cause;
    }
  });
  for (const action of ["start", "calculate"] as const) app.post(`/v1/assessments/${action}`, async c => {
    c.header("Cache-Control", "no-store");
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    const schema = action === "start" ? z.object({ assessmentReference: reference }).strict() : z.object({ assessmentReference: reference, idempotencyKey: z.string().min(8).max(128), answers: answersSchema, faceScanSessionId: z.string().min(1).max(128).optional() }).strict();
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    try {
      const { binding, rule } = await store.bindAssessment({ identity, assessmentReference: parsed.data.assessmentReference, platformEnabled, create: action === "start" });
      const definition = versionedRuleDefinitionSchema.parse(rule.definition);
      const evidence = { assessmentReference: binding.assessmentReference, bindingId: binding.id, ruleVersionId: rule.id, checksum: binding.checksum, version: rule.version };
      if (action === "start") return c.json({ ...evidence, questionnaire: publicQuestionnaire(definition) });
      const input = parsed.data as { assessmentReference: string; idempotencyKey: string; answers: z.infer<typeof answersSchema>; faceScanSessionId?: string };
      if (input.faceScanSessionId && !isFinalAssessmentDefinition(definition)) return c.json({ error: "INVALID_REQUEST" }, 400);
      const evaluated = evaluateVersionedRule(definition, input.answers);
      const resultBase = { ...evaluated, ...evidence, calculatedAt: now().toISOString() };
      if (isFinalAssessmentDefinition(definition) && evaluated.issues.length) return c.json({ error: "INVALID_ASSESSMENT_ANSWERS", result: resultBase }, 400);
      if (!evaluated.complete) return c.json({ error: "ASSESSMENT_INCOMPLETE", result: resultBase }, 422);
      const scanPoints = input.faceScanSessionId ? await store.faceScanPoints({ identity, assessmentReference: binding.assessmentReference, sessionId: input.faceScanSessionId, ruleVersionId: rule.id }) : null;
      if (input.faceScanSessionId && scanPoints === null) return c.json({ error: "FACE_SCAN_UNAVAILABLE" }, 422);
      const score = evaluated.score === null ? scanPoints : scanPoints === null ? evaluated.score : evaluated.score + scanPoints;
      if (score !== null && (!Number.isFinite(score) || score < 0 || score > Number.MAX_SAFE_INTEGER)) return c.json({ error: "INVALID_SCORE" }, 422);
      const classification = score === null ? null : classifyScore(definition, score);
      if (score !== null && !classification) return c.json({ error: "UNMATCHED_CLASSIFICATION" }, 422);
      const result = isFinalAssessmentDefinition(definition) ? { ...resultBase, score, classification, questionnaireScore: evaluated.score, faceScan: input.faceScanSessionId ? { sessionId: input.faceScanSessionId, points: scanPoints! } : null,
        riskCategories: publicRiskCategories(definition) } : resultBase;
      const reservation = await store.reserveUsage({ identity, clientId: identity.clientId, capability: "SCORING", assessmentReference: binding.assessmentReference, idempotencyKey: input.idempotencyKey, platformEnabled, binding, fingerprint: ruleChecksum({ endpoint: "assessment", bindingId: binding.id, checksum: binding.checksum, answers: input.answers, faceScanSessionId: input.faceScanSessionId ?? null }) });
      if (reservation.status === "REJECTED") return c.json({ error: "SCORING_UNAVAILABLE", reason: reservation.reason }, 409);
      if (reservation.status === "DUPLICATE") return c.json(reservation.response as never);
      try {
        const response = { result: { ...result, resultReference: reservation.usageId }, idempotencyKey: input.idempotencyKey };
        await store.completeUsage(reservation.usageId, response);
        return c.json(response);
      } catch (cause) { await store.failUsage(reservation.usageId); throw cause; }
    } catch (cause) {
      if (cause instanceof BindingError) return c.json({ error: cause.code }, cause.code === "ASSESSMENT_NOT_FOUND" ? 404 : 409);
      throw cause;
    }
  });
  app.post("/v1/assessments/classify-reviewed", async c => {
    c.header("Cache-Control", "no-store");
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    const parsed = z.object({ assessmentReference: reference, idempotencyKey: z.string().min(8).max(128), score: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    const input = parsed.data;
    try {
      const { binding, rule } = await store.bindAssessment({ identity, assessmentReference: input.assessmentReference, platformEnabled, create: false });
      const classification = classifyScore(versionedRuleDefinitionSchema.parse(rule.definition), input.score);
      if (!classification) return c.json({ error: "UNMATCHED_CLASSIFICATION" }, 422);
      const reservation = await store.reserveUsage({ identity, clientId: identity.clientId, capability: "SCORING", assessmentReference: binding.assessmentReference, idempotencyKey: input.idempotencyKey, platformEnabled, binding, fingerprint: ruleChecksum({ endpoint: "classify-reviewed", bindingId: binding.id, checksum: binding.checksum, score: input.score }) });
      if (reservation.status === "REJECTED") return c.json({ error: "SCORING_UNAVAILABLE", reason: reservation.reason }, 409);
      if (reservation.status === "DUPLICATE") return c.json(reservation.response as never);
      try {
        const response = { result: { assessmentReference: binding.assessmentReference, bindingId: binding.id, ruleVersionId: rule.id, checksum: binding.checksum, version: rule.version, resultReference: reservation.usageId, score: input.score, classification, calculatedAt: now().toISOString() }, idempotencyKey: input.idempotencyKey };
        await store.completeUsage(reservation.usageId, response);
        return c.json(response);
      } catch (cause) { await store.failUsage(reservation.usageId); throw cause; }
    } catch (cause) {
      if (cause instanceof BindingError) return c.json({ error: cause.code }, cause.code === "ASSESSMENT_NOT_FOUND" ? 404 : 409);
      throw cause;
    }
  });

}
