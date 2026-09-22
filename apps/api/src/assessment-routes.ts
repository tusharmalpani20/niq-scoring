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
export function installAssessmentRoutes(app: Hono, store: ScoringStore, authenticate: (c: Context) => Promise<DeploymentIdentity | null>, now: () => Date, platformEnabled: boolean) {
  for (const action of ["start", "calculate"] as const) app.post(`/v1/assessments/${action}`, async c => {
    c.header("Cache-Control", "no-store");
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    const schema = action === "start" ? z.object({ assessmentReference: reference }).strict() : z.object({ assessmentReference: reference, idempotencyKey: z.string().min(8).max(128), answers: answersSchema }).strict();
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    try {
      const { binding, rule } = await store.bindAssessment({ identity, assessmentReference: parsed.data.assessmentReference, platformEnabled, create: action === "start" });
      const definition = versionedRuleDefinitionSchema.parse(rule.definition);
      const evidence = { assessmentReference: binding.assessmentReference, bindingId: binding.id, ruleVersionId: rule.id, checksum: binding.checksum, version: rule.version };
      if (action === "start") return c.json({ ...evidence, questionnaire: publicQuestionnaire(definition) });
      const input = parsed.data as { assessmentReference: string; idempotencyKey: string; answers: z.infer<typeof answersSchema> };
      const result = { ...evaluateVersionedRule(definition, input.answers), ...evidence, calculatedAt: now().toISOString() };
      if (isFinalAssessmentDefinition(definition) && result.issues.length) return c.json({ error: "INVALID_ASSESSMENT_ANSWERS", result }, 400);
      if (!result.complete) return c.json({ error: "ASSESSMENT_INCOMPLETE", result }, 422);
      const reservation = await store.reserveUsage({ identity, clientId: identity.clientId, capability: "SCORING", assessmentReference: binding.assessmentReference, idempotencyKey: input.idempotencyKey, platformEnabled, binding, fingerprint: ruleChecksum({ endpoint: "assessment", bindingId: binding.id, checksum: binding.checksum, answers: input.answers }) });
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
