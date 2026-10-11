import type { Context, Hono } from "hono";
import { z } from "zod";
import { answersSchema } from "@niq-scoring/contracts/rules";
import { isFinalAssessmentDefinition, versionedRuleDefinitionSchema } from "@niq-scoring/contracts/versioned-definition";
import { publicQuestionnaire } from "@niq-scoring/contracts/rule-public";
import { resolveReportGuidance } from "@niq-scoring/contracts/report-guidance";
import { resolveCarePlanGuidance } from "@niq-scoring/contracts/care-plan-resolver";
import { cancerTypeIds } from "@niq-scoring/contracts/cancer-type-ids";
import { classifyScore, evaluateVersionedRule } from "@niq-scoring/scoring-engine/versioned";
import { BindingError } from "./assessment-binding";
import { ruleChecksum } from "./rule-routes";
import type { DeploymentIdentity, ScoringStore } from "./store";
const reference = z.string().trim().min(1).max(128);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid YYYY-MM-DD date.");
const publicRiskCategories = (definition: Extract<z.infer<typeof versionedRuleDefinitionSchema>, { profile: "NIQ_FINAL_ASSESSMENT" }>) =>
  definition.riskCategories.map(({ id, label, color, min, max, minInclusive, maxInclusive }) => ({ id, label, color, min, max, minInclusive, maxInclusive }));
export function installAssessmentRoutes(app: Hono, store: ScoringStore, authenticate: (c: Context) => Promise<DeploymentIdentity | null>, now: () => Date, platformEnabled: boolean) {
  // Server-to-server guidance lookup uses the assessment's pinned rule version.
  // The score comes from a completed result for this assessment. The caller
  // supplies explicitly confirmed toxicities; possible effects are not symptoms.
  app.post("/v1/assessments/report-guidance", async c => {
    c.header("Cache-Control", "no-store");
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    const ids = z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)).max(500);
    const parsed = z.object({
      assessmentReference: reference,
      resultReference: reference,
      treatmentTypeIds: ids, drugClassIds: ids,
      confirmedToxicityIds: ids,
      coMorbidityIds: ids.optional(),
      cancerTypeId: z.string().optional(),
      dietPreferenceId: z.enum(["vegetarian", "non_vegetarian", "eggetarian", "jain"]).optional(),
      treatmentStatusId: z.string().optional(), surgicalStatusId: z.string().optional(),
      surgeryDate: calendarDate.optional(), plannedSurgeryDate: calendarDate.optional(), plannedTreatmentStartDate: calendarDate.optional(),
      productStageChoice: z.enum(["surgical", "treatment_stage"]).optional(),
    }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    try {
      const { binding, rule } = await store.bindAssessment({ identity, assessmentReference: parsed.data.assessmentReference, platformEnabled, create: false });
      const definition = versionedRuleDefinitionSchema.parse(rule.definition);
      if (!isFinalAssessmentDefinition(definition)) return c.json({ error: "VERSION_UNAVAILABLE" }, 409);
      const stored = await store.completedScoringResult({ identity, assessmentReference: binding.assessmentReference, resultReference: parsed.data.resultReference });
      if (!stored) return c.json({ error: "SCORING_RESULT_NOT_FOUND" }, 404);
      const result = z.object({ result: z.object({ resultReference: reference, assessmentReference: reference,
        bindingId: reference, ruleVersionId: reference, checksum: reference,
        score: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).nullable() }).passthrough() }).passthrough().safeParse(stored);
      if (!result.success || result.data.result.resultReference !== parsed.data.resultReference
        || result.data.result.assessmentReference !== binding.assessmentReference
        || result.data.result.bindingId !== binding.id || result.data.result.ruleVersionId !== rule.id
        || result.data.result.checksum !== binding.checksum) return c.json({ error: "INVALID_SCORING_RESULT" }, 409);
      if (result.data.result.score === null) return c.json({ error: "SCORE_UNAVAILABLE" }, 409);
      const classification = classifyScore(definition, result.data.result.score);
      if (!classification) return c.json({ error: "UNMATCHED_CLASSIFICATION" }, 422);
      const configuredClasses = new Set(definition.drugClassConfig?.classes.map(item => item.id) ?? []);
      const configuredTreatments = new Set(definition.sections.flatMap(section => section.fields)
        .filter(field => field.id === "current_cancer_treatment" && "options" in field)
        .flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
      const optionSet = (fieldId: string) => new Set(definition.sections.flatMap(section => section.fields)
        .filter(field => field.id === fieldId && "options" in field)
        .flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
      const configuredConditions = optionSet("co_morbidities");
      const configuredStatuses = optionSet("treatment_status");
      const configuredSurgicalStatuses = optionSet("cancer_surgical_status");
      if (parsed.data.drugClassIds.some(id => id !== "other" && !configuredClasses.has(id))
        || parsed.data.treatmentTypeIds.some(id => !configuredTreatments.has(id))
        || parsed.data.drugClassIds.includes("other") && parsed.data.drugClassIds.length > 1
        || parsed.data.coMorbidityIds?.some(id => !configuredConditions.has(id))
        || parsed.data.treatmentStatusId && !configuredStatuses.has(parsed.data.treatmentStatusId)
        || parsed.data.surgicalStatusId && !configuredSurgicalStatuses.has(parsed.data.surgicalStatusId)
        || parsed.data.cancerTypeId && !cancerTypeIds.includes(parsed.data.cancerTypeId as typeof cancerTypeIds[number])
        || parsed.data.surgeryDate && parsed.data.surgicalStatusId !== "cancer_surgical_status_done"
        || parsed.data.plannedSurgeryDate && parsed.data.surgicalStatusId !== "cancer_surgical_status_planned") {
        return c.json({ error: "INVALID_GUIDANCE_FACTS" }, 400);
      }
      const matched = resolveReportGuidance(definition, {
        riskCategoryId: classification.id,
        treatmentTypeIds: parsed.data.treatmentTypeIds,
        drugClassIds: parsed.data.drugClassIds,
        confirmedToxicityIds: parsed.data.confirmedToxicityIds,
      });
      const carePlan = resolveCarePlanGuidance(definition, {
        riskCategoryId: classification.id,
        treatmentTypeIds: parsed.data.treatmentTypeIds,
        drugClassIds: parsed.data.drugClassIds,
        coMorbidityIds: parsed.data.coMorbidityIds ?? [],
        cancerTypeId: parsed.data.cancerTypeId ?? null,
        dietPreferenceId: parsed.data.dietPreferenceId ?? null,
        treatmentStatusId: parsed.data.treatmentStatusId ?? null,
        surgicalStatusId: parsed.data.surgicalStatusId ?? null,
        surgeryDate: parsed.data.surgeryDate ?? null,
        plannedSurgeryDate: parsed.data.plannedSurgeryDate ?? null,
        plannedTreatmentStartDate: parsed.data.plannedTreatmentStartDate ?? null,
        productStageChoice: parsed.data.productStageChoice ?? null,
        asOfDate: now().toISOString().slice(0, 10),
      });
      return c.json({ assessmentReference: binding.assessmentReference, bindingId: binding.id,
        ruleVersionId: rule.id, checksum: binding.checksum, classification: { id: classification.id, label: classification.label },
        guidance: { ...matched, carePlan } });
    } catch (cause) {
      if (cause instanceof BindingError) return c.json({ error: cause.code }, cause.code === "ASSESSMENT_NOT_FOUND" ? 404 : 409);
      throw cause;
    }
  });
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
