import { isFixedRuleDefinition } from "@niq-scoring/contracts/fixed-profile";
import type { Hono, Context } from "hono";
import { z } from "zod";
import { ruleDefinitionSchema, answersSchema } from "@niq-scoring/contracts/rules";
import { createSpreadsheetTemplate } from "@niq-scoring/contracts/rule-template";
import { validateRuleDefinition } from "@niq-scoring/contracts/rule-validation";
import { evaluateRule, validateSamples } from "@niq-scoring/scoring-engine/rules";
import { ulidSchema } from "@niq-scoring/contracts";
import { RuleStoreError, type RuleStore } from "./rule-store";
import { createEntityId } from "./lib/id";

// Sorted keys make checksums independent of JSON object insertion order; array order remains meaningful.
export function canonicalRuleJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRuleJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalRuleJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function ruleChecksum(value: unknown) { return new Bun.CryptoHasher("sha256").update(canonicalRuleJson(value)).digest("hex"); }
const revisionSchema = z.object({ revision: z.number().int().positive() }).strict();
const createSchema = z.object({ name: z.string().trim().min(1).max(80), requestId: z.uuid(), template: z.literal("spreadsheet").default("spreadsheet"), duplicateId: ulidSchema.optional() }).strict();

export function installRuleRoutes(app: Hono, store: RuleStore, now: () => Date) {
  const guard = (handler: (c: Context) => Promise<Response>) => async (c: Context) => {
    try { return await handler(c); }
    catch (error) { if (error instanceof RuleStoreError) return c.json({ error: error.code }, error.code === "RULE_NOT_FOUND" ? 404 : 409); throw error; }
  };
  const actor = (c: Context): string => c.get("adminUserId");
  app.get("/admin/rules", guard(async c => c.json({ versions: (await store.list()).map(({ definition, ...record }) => ({ ...record, editable: isFixedRuleDefinition(definition) && ["DRAFT", "VALIDATED"].includes(record.lifecycle), duplicable: isFixedRuleDefinition(definition), deletable: ruleDefinitionSchema.safeParse(definition).success && record.lifecycle === "DRAFT" })) })));
  app.post("/admin/rules", guard(async c => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    const input = parsed.data;
    const fingerprint = ruleChecksum({ actor: actor(c), ...input });
    // Replay before loading the source: the source may have changed or been deleted since creation.
    const prior = await store.replayCreate(input.requestId, fingerprint, actor(c));
    if (prior) return c.json(prior, 201);
    let definition = createSpreadsheetTemplate(input.name);
    if (input.duplicateId) {
      const source = await store.get(input.duplicateId);
      if (!source) throw new RuleStoreError("RULE_NOT_FOUND");
      const sourceDefinition = ruleDefinitionSchema.safeParse(source.definition);
      if (!sourceDefinition.success) return c.json({ error: "LEGACY_RULE_FORMAT" }, 409);
      if (!isFixedRuleDefinition(sourceDefinition.data)) return c.json({ error: "FIXED_RULE_REQUIRED" }, 409);
      definition = { ...sourceDefinition.data, name: input.name };
    }
    const record = await store.create({ id: createEntityId(), definition, checksum: ruleChecksum(definition), actor: actor(c), requestId: input.requestId, fingerprint, now: now().toISOString() });
    return c.json(record, 201);
  }));
  app.get("/admin/rules/:id", guard(async c => {
    const record = await store.get(c.req.param("id")!);
    if (!record) throw new RuleStoreError("RULE_NOT_FOUND");
    return c.json({ ...record, audit: await store.audit(record.id) });
  }));
  app.put("/admin/rules/:id", guard(async c => {
    const parsed = z.object({ revision: z.number().int().positive(), definition: ruleDefinitionSchema }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_RULE_DEFINITION", issues: parsed.error.issues }, 400);
    if (!isFixedRuleDefinition(parsed.data.definition)) return c.json({ error: "FIXED_RULE_REQUIRED" }, 409);
    const issues = validateRuleDefinition(parsed.data.definition).filter(i => i.severity === "error");
    if (issues.length) return c.json({ error: "INVALID_RULE_DEFINITION", issues }, 400);
    if (parsed.data.definition.name.length > 80) return c.json({ error: "INVALID_RULE_NAME" }, 400);
    const current = await store.get(c.req.param("id")!);
    if (current && !ruleDefinitionSchema.safeParse(current.definition).success) return c.json({ error: "LEGACY_RULE_FORMAT" }, 409);
    if (current && !isFixedRuleDefinition(current.definition)) return c.json({ error: "FIXED_RULE_REQUIRED" }, 409);
    return c.json(await store.save({ id: c.req.param("id")!, ...parsed.data, checksum: ruleChecksum(parsed.data.definition), actor: actor(c), now: now().toISOString() }));
  }));
  app.post("/admin/rules/:id/preview", guard(async c => {
    const parsed = z.object({ revision: z.number().int().positive(), answers: answersSchema }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    const record = await store.get(c.req.param("id")!);
    if (!record) throw new RuleStoreError("RULE_NOT_FOUND");
    if (record.revision !== parsed.data.revision) throw new RuleStoreError("RULE_REVISION_CONFLICT");
    const definition = ruleDefinitionSchema.safeParse(record.definition);
    if (!definition.success) return c.json({ error: "LEGACY_RULE_FORMAT" }, 409);
    c.header("Cache-Control", "no-store");
    return c.json({ ...evaluateRule(definition.data, parsed.data.answers), ruleVersionId: record.id, checksum: record.packageChecksum, calculatedAt: now().toISOString(), preview: true });
  }));
  app.post("/admin/rules/:id/:action", guard(async c => {
    const action = z.enum(["validate", "approve", "activate", "retire", "check"]).safeParse(c.req.param("action"));
    const parsed = revisionSchema.safeParse(await c.req.json().catch(() => null));
    if (!action.success || !parsed.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    const record = await store.get(c.req.param("id")!);
    if (!record) throw new RuleStoreError("RULE_NOT_FOUND");
    if (record.revision !== parsed.data.revision) throw new RuleStoreError("RULE_REVISION_CONFLICT");
    const definition = ruleDefinitionSchema.safeParse(record.definition);
    if (!definition.success) return c.json({ error: "LEGACY_RULE_FORMAT" }, 409);
    if (["validate", "approve"].includes(action.data) && !isFixedRuleDefinition(definition.data)) return c.json({ error: "FIXED_RULE_REQUIRED" }, 409);
    if (["check", "validate", "approve"].includes(action.data)) {
      const issues = [...validateRuleDefinition(definition.data), ...validateSamples(definition.data)];
      if (action.data === "check") return c.json({ issues, revision: record.revision, checksum: record.packageChecksum });
      if (issues.length) return c.json({ error: "RULE_VALIDATION_FAILED", issues }, 422);
    }
    return c.json(await store.transition({ id: record.id, revision: parsed.data.revision, action: action.data as "validate" | "approve" | "activate" | "retire", actor: actor(c), now: now().toISOString() }));
  }));
  app.delete("/admin/rules/:id", guard(async c => {
    const parsed = revisionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    const current = await store.get(c.req.param("id")!);
    if (current && !ruleDefinitionSchema.safeParse(current.definition).success) return c.json({ error: "LEGACY_RULE_FORMAT" }, 409);
    await store.delete(c.req.param("id")!, parsed.data.revision, actor(c), now().toISOString()); return c.json({ deleted: true });
  }));
}
