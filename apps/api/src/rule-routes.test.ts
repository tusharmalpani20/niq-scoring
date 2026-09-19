import { createSpreadsheetTemplate } from "@niq-scoring/contracts/rule-template";
import { describe, expect, test } from "bun:test";
import { type RuleDefinition } from "@niq-scoring/contracts/rules";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { createApp } from "./app";
import { MemoryScoringStore } from "./store";
import type { RuleAudit, RuleRecord } from "./rule-store";

const actorId = "01J00000000000000000000001";
const now = "2026-09-13T00:00:00.000Z";
const headers = { cookie: "niq_scoring_session=rule-test-session", origin: "http://localhost:4173", "content-type": "application/json" };
function setup() {
  const store = new MemoryScoringStore();
  const authStore = new MemoryAdminAuthStore();
  authStore.state.users.push({ id: actorId, email: "rules@niq.test", displayName: "Rule administrator", enabled: true, createdAt: now, passwordHash: "unused" });
  authStore.state.sessions.push({ userId: actorId, tokenHash: new Bun.CryptoHasher("sha256").update("rule-test-session").digest("hex"), expiresAt: "2027-01-01T00:00:00.000Z" });
  const app = createApp({ store, authStore, allowedOrigins: [headers.origin], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => new Date(now) });
  const request = (path: string, method = "GET", body?: unknown) => app.request(`/admin/rules${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const create = async (name = "Synthetic test", extra: Record<string, unknown> = {}) => {
    const response = await request("", "POST", { name, requestId: crypto.randomUUID(), template: "spreadsheet", ...extra });
    expect(response.status).toBe(201);
    return await response.json() as RuleRecord;
  };
  return { app, store, authStore, request, create };
}

// Deliberately synthetic points and independently specified expected results; not clinical content.
function synthetic(name: string): RuleDefinition {
  const definition = createSpreadsheetTemplate(name);
  const domains = definition.domains.filter(d => d.id !== "unassigned");
  definition.scoring = definition.scoring.map((rule, i) => {
    const domainId = domains[i % domains.length]!.id;
    if (rule.kind === "options") return { ...rule, domainId, points: definition.sections.flatMap(s => s.questions).find(q => q.id === rule.questionId)!.options.map(o => ({ optionId: o.id, points: 0 })) };
    if (rule.kind === "condition") return { ...rule, domainId, points: 0, otherwise: 0 };
    return { ...rule, domainId, bands: rule.bands.map((b, i) => ({ ...b, points: 0, minInclusive: i > 0, maxInclusive: false })) };
  });
  definition.classifications[1]!.min = 15;
  definition.classifications[1]!.minInclusive = false;
  definition.issues = definition.issues.map(i => ({ ...i, resolved: true, resolution: "Synthetic test decision only; not clinical approval." }));
  const answers: Record<string, string | number | boolean | string[]> = {};
  for (const question of definition.sections.flatMap(s => s.questions)) {
    if (question.visibleWhen) continue;
    if (question.type === "number") answers[question.id] = 1;
    else if (question.type === "boolean") answers[question.id] = false;
    else if (question.type === "single_select") answers[question.id] = question.options[0]!.id;
    else if (question.type === "multi_select") answers[question.id] = [question.options[0]!.id];
  }
  definition.samples = [{ id: "boundary_example", name: "Synthetic zero point configuration", answers, expected: { complete: true, score: 0, classificationId: "low_risk", interventionIds: [], domains: {}, calculations: {} } }];
  return definition;
}

async function savedSynthetic(context: ReturnType<typeof setup>, name = "Synthetic only") {
  const draft = await context.create(name);
  const response = await context.request(`/${draft.id}`, "PUT", { revision: draft.revision, definition: synthetic(name) });
  expect(response.status).toBe(200);
  return await response.json() as RuleRecord;
}

describe("rule management API", () => {
  test("mutation responses include the recorded lifecycle history", async () => {
    const context = setup();
    const input = { name: "Audit response", template: "spreadsheet", requestId: crypto.randomUUID() };
    let rule = await (await context.request("", "POST", input)).json() as RuleRecord & { audit: RuleAudit[] };
    expect(rule.audit).toHaveLength(1);
    expect(rule.audit[0]).toMatchObject({ actor: actorId, action: "RULE_CREATED", at: now, revision: 1, checksum: rule.packageChecksum });
    const replay = await (await context.request("", "POST", input)).json() as typeof rule;
    expect(replay.audit).toEqual(rule.audit);
    rule = await (await context.request(`/${rule.id}`, "PUT", { revision: rule.revision, definition: synthetic(input.name) })).json() as typeof rule;
    expect(rule.audit.map(event => event.action)).toEqual(["RULE_CREATED", "RULE_SAVED"]);
    for (const [action, event] of [["validate", "RULE_VALIDATED"], ["approve", "RULE_APPROVED"], ["activate", "RULE_ACTIVE"], ["retire", "RULE_RETIRED"]] as const) {
      const priorLength = rule.audit.length;
      const response = await context.request(`/${rule.id}/${action}`, "POST", { revision: rule.revision });
      expect(response.status).toBe(200);
      rule = await response.json() as typeof rule;
      expect(rule.audit).toHaveLength(priorLength + 1);
      expect(rule.audit.at(-1)).toMatchObject({ actor: actorId, action: event, at: now, revision: rule.revision, checksum: rule.packageChecksum });
      expect(rule.audit).toEqual(await context.store.rules.audit(rule.id));
    }
  });

  test("requires an enabled administrator session and allowed origin", async () => {
    const { app, authStore, request, create } = setup();
    const rule = await create();
    for (const [path, method] of [["", "GET"], ["", "POST"], [`/${rule.id}`, "GET"], [`/by-name/${encodeURIComponent(rule.version)}`, "GET"], [`/${rule.id}`, "PUT"], [`/${rule.id}`, "DELETE"], [`/${rule.id}/preview`, "POST"], [`/${rule.id}/validate`, "POST"]] as const) {
      const response = await app.request(`/admin/rules${path}`, { method, headers: { origin: headers.origin, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: "{}" }) });
      expect(response.status).toBe(401);
    }
    expect((await app.request("/admin/rules", { method: "POST", headers: { ...headers, origin: "https://untrusted.test" }, body: "{}" })).status).toBe(403);
    authStore.state.users[0]!.enabled = false;
    expect((await request("")).status).toBe(401);
  });

  test("creation retries return one draft and changed retry payload conflicts", async () => {
    const { request } = setup();
    const input = { name: "Synthetic retry", requestId: crypto.randomUUID() };
    const responses = await Promise.all([request("", "POST", input), request("", "POST", input)]);
    expect(responses.map(r => r.status)).toEqual([201, 201]);
    const [first, retry] = await Promise.all(responses.map(r => r.json()));
    expect(retry).toEqual(first);
    expect(first).toMatchObject({ version: input.name, revision: 1, lifecycle: "DRAFT", clinicalUsePermitted: false, createdBy: actorId });
    const changed = await request("", "POST", { ...input, name: "Different" });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "RULE_REQUEST_CONFLICT" });
    const list = await (await request("")).json() as { versions: RuleRecord[] };
    expect(list.versions).toHaveLength(1);
    expect(list.versions[0]).not.toHaveProperty("definition");
  });

  test("duplicate retry returns the original copy even after its source draft is deleted", async () => {
    const { request, create } = setup();
    const source = await create("Source draft");
    const input = { name: "Retried copy", requestId: crypto.randomUUID(), duplicateId: source.id };
    const created = await request("", "POST", input);
    expect(created.status).toBe(201);
    const copy = await created.json();
    expect((await request(`/${source.id}`, "DELETE", { revision: source.revision })).status).toBe(200);
    const retry = await request("", "POST", input);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(copy);
  });

  test("normalized names are unique on concurrent creation and rename", async () => {
    const { request, create } = setup();
    const responses = await Promise.all(["Example", " example "].map(name => request("", "POST", { name, requestId: crypto.randomUUID() })));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const second = await create("Other");
    const renamed = await request(`/${second.id}`, "PUT", { revision: second.revision, definition: { ...(second.definition as RuleDefinition), name: "EXAMPLE" } });
    expect(renamed.status).toBe(409);
    expect(await renamed.json()).toEqual({ error: "RULE_NAME_EXISTS" });
    expect((await (await request(`/${second.id}`)).json() as RuleRecord).version).toBe("Other");
  });

  test("readable names retain rename aliases and reserve deleted names", async () => {
    const { request, create } = setup();
    const draft = await create("Assessment / A #1");
    const lookup = (name: string) => request(`/by-name/${encodeURIComponent(name)}`);
    expect(await (await lookup(" assessment / a #1 ")).json()).toMatchObject({ id: draft.id, audit: [{ action: "RULE_CREATED" }] });
    const name = "01M2T6J93S5GTN6PCJNFAQ0WJ2";
    const renamed = await request(`/${draft.id}`, "PUT", { revision: 1, definition: { ...(draft.definition as RuleDefinition), name } });
    expect(renamed.status).toBe(200);
    for (const alias of [draft.version, name]) expect(await (await lookup(alias)).json()).toMatchObject({ id: draft.id, version: name, revision: 2 });
    const other = await create("Other version");
    expect((await request(`/${other.id}`, "PUT", { revision: 1, definition: { ...(other.definition as RuleDefinition), name: draft.version } })).status).toBe(409);
    expect((await request(`/${draft.id}`, "DELETE", { revision: 2 })).status).toBe(200);
    for (const alias of [draft.version, name]) {
      expect((await lookup(alias)).status).toBe(404);
      expect((await request("", "POST", { name: alias, requestId: crypto.randomUUID() })).status).toBe(409);
    }
    expect((await lookup("unknown")).status).toBe(404);
  });

  test("query lookup preserves dot-only names that path normalization would remove", async () => {
    const { request, create } = setup();
    for (const name of [".", ".."]) {
      const draft = await create(name);
      expect(await (await request(`/by-name?name=${encodeURIComponent(name)}`)).json()).toMatchObject({ id: draft.id, version: name });
    }
    expect((await request("/by-name")).status).toBe(400);
  });

  test("save, reopen and duplicate preserve definitions without linking draft edits", async () => {
    const context = setup();
    const saved = await savedSynthetic(context);
    expect(saved.revision).toBe(2);
    const reopened = await (await context.request(`/${saved.id}`)).json() as RuleRecord & { audit: RuleAudit[] };
    expect(reopened.definition).toEqual(synthetic(saved.version));
    expect(reopened.audit.map(event => event.action)).toEqual(["RULE_CREATED", "RULE_SAVED"]);
    expect(reopened.audit.every(event => event.actor === actorId && event.at === now)).toBe(true);
    expect(reopened.audit.at(-1)?.checksum).toBe(saved.packageChecksum);
    const duplicate = await context.create("Synthetic copy", { duplicateId: saved.id });
    expect(duplicate.id).not.toBe(saved.id);
    expect(duplicate.definition).toEqual({ ...synthetic(saved.version), name: "Synthetic copy" });
    expect(duplicate).toMatchObject({ lifecycle: "DRAFT", revision: 1, validatedRevision: null });
    const definition = synthetic(saved.version); definition.description = "Edited original";
    expect((await context.request(`/${saved.id}`, "PUT", { revision: saved.revision, definition })).status).toBe(200);
    expect((await (await context.request(`/${duplicate.id}`)).json() as RuleRecord).definition).toEqual(duplicate.definition);
  });

  test("concurrent saves reject stale revisions without overwriting the winner", async () => {
    const { request, create } = setup();
    const draft = await create();
    const a = structuredClone(draft.definition as RuleDefinition); a.description = "First writer";
    const b = structuredClone(draft.definition as RuleDefinition); b.description = "Second writer";
    const responses = await Promise.all([a, b].map(definition => request(`/${draft.id}`, "PUT", { revision: 1, definition })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = await responses.find(r => r.status === 200)!.json() as RuleRecord;
    expect(await responses.find(r => r.status === 409)!.json()).toEqual({ error: "RULE_REVISION_CONFLICT" });
    const current = await (await request(`/${draft.id}`)).json() as RuleRecord;
    expect(current.definition).toEqual(winner.definition);
    expect(current.revision).toBe(2);
    expect((await request(`/${draft.id}/preview`, "POST", { revision: 1, answers: {} })).status).toBe(409);
  });

  test("backend rejects broken references and unsupported schema without altering the draft", async () => {
    const { request, create } = setup();
    const draft = await create();
    const broken = synthetic(draft.version); broken.scoring[0]!.domainId = "missing_domain";
    const invalid = await request(`/${draft.id}`, "PUT", { revision: 1, definition: broken });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "INVALID_RULE_DEFINITION" });
    expect((await request(`/${draft.id}`, "PUT", { revision: 1, definition: { ...synthetic(draft.version), script: "return 1" } })).status).toBe(400);
    expect((await (await request(`/${draft.id}`)).json() as RuleRecord).revision).toBe(1);
  });

  test("source template persists as a draft but unresolved source rules block validation and approval", async () => {
    const { request, create } = setup();
    const draft = await create("Spreadsheet review", { template: "spreadsheet" });
    const definition = draft.definition as RuleDefinition;
    expect(definition.sections.length).toBeGreaterThan(1);
    expect(definition.issues.some(issue => issue.blocking && !issue.resolved)).toBe(true);
    const check = await request(`/${draft.id}/check`, "POST", { revision: 1 });
    expect(check.status).toBe(200);
    expect((await check.json() as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    for (const action of ["validate", "approve"]) {
      const response = await request(`/${draft.id}/${action}`, "POST", { revision: 1 });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: "RULE_VALIDATION_FAILED" });
    }
    expect((await (await request(`/${draft.id}`)).json() as RuleRecord).lifecycle).toBe("DRAFT");
  });

  test("sample failures block validation and editing invalidates a validated revision", async () => {
    const context = setup();
    let rule = await savedSynthetic(context);
    const wrong = synthetic(rule.version); wrong.samples[0]!.expected.score = 6;
    rule = await (await context.request(`/${rule.id}`, "PUT", { revision: rule.revision, definition: wrong })).json() as RuleRecord;
    expect((await context.request(`/${rule.id}/validate`, "POST", { revision: rule.revision })).status).toBe(422);
    rule = await (await context.request(`/${rule.id}`, "PUT", { revision: rule.revision, definition: synthetic(rule.version) })).json() as RuleRecord;
    rule = await (await context.request(`/${rule.id}/validate`, "POST", { revision: rule.revision })).json() as RuleRecord;
    expect(rule).toMatchObject({ lifecycle: "VALIDATED", validatedRevision: rule.revision });
    const edited = synthetic(rule.version); edited.description = "Changed after validation";
    rule = await (await context.request(`/${rule.id}`, "PUT", { revision: rule.revision, definition: edited })).json() as RuleRecord;
    expect(rule).toMatchObject({ lifecycle: "DRAFT", validatedRevision: null });
    const approval = await context.request(`/${rule.id}/approve`, "POST", { revision: rule.revision });
    expect(approval.status).toBe(409);
    expect(await approval.json()).toEqual({ error: "INVALID_RULE_TRANSITION" });
  });

  test("synthetic lifecycle preserves contents and preview does not record clinical usage", async () => {
    const context = setup();
    let rule = await savedSynthetic(context);
    const checksum = rule.packageChecksum;
    const preview = await context.request(`/${rule.id}/preview`, "POST", { revision: rule.revision, answers: (rule.definition as RuleDefinition).samples[0]!.answers });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    expect(await preview.json()).toMatchObject({ complete: true, score: 0, classification: { id: "low_risk" }, ruleVersionId: rule.id, checksum, calculatedAt: now, preview: true });
    const missing = await context.request(`/${rule.id}/preview`, "POST", { revision: rule.revision, answers: {} });
    expect(await missing.json()).toMatchObject({ complete: false, score: null });
    expect(context.store.usages).toHaveLength(0);
    expect(context.store.faceScans).toHaveLength(0);
    expect((await context.request(`/${rule.id}/activate`, "POST", { revision: rule.revision })).status).toBe(409);
    for (const [action, lifecycle] of [["validate", "VALIDATED"], ["approve", "APPROVED"], ["activate", "ACTIVE"], ["retire", "RETIRED"]] as const) {
      const response = await context.request(`/${rule.id}/${action}`, "POST", { revision: rule.revision });
      expect(response.status).toBe(200);
      rule = await response.json() as RuleRecord;
      expect(rule.lifecycle).toBe(lifecycle);
      expect(rule.packageChecksum).toBe(checksum);
      if (lifecycle !== "VALIDATED") {
        expect((await context.request(`/${rule.id}`, "PUT", { revision: rule.revision, definition: synthetic(rule.version) })).status).toBe(409);
        expect((await context.request(`/${rule.id}`, "DELETE", { revision: rule.revision })).status).toBe(409);
      }
    }
    expect(rule.clinicalUsePermitted).toBe(false);
    const audit = await context.store.rules.audit(rule.id);
    expect(audit.map(event => event.action)).toEqual(["RULE_CREATED", "RULE_SAVED", "RULE_VALIDATED", "RULE_APPROVED", "RULE_ACTIVE", "RULE_RETIRED"]);
    expect(audit.map(event => event.revision)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("a referenced draft cannot be deleted even when the caller has its current revision", async () => {
    const { request, create, store } = setup();
    const draft = await create("Referenced legacy draft");
    // Represents a pre-existing assignment; new assignment eligibility is enforced separately.
    store.assignments.push({ deploymentId: "01J00000000000000000000002", mode: "PINNED", scoringRuleVersionId: draft.id });
    const response = await request(`/${draft.id}`, "DELETE", { revision: draft.revision });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "RULE_IN_USE" });
    expect((await request(`/${draft.id}`)).status).toBe(200);
    expect((await store.rules.audit(draft.id)).map(event => event.action)).toEqual(["RULE_CREATED"]);
  });

  test("deleting an unused draft retains audit and a retry cannot resurrect it", async () => {
    const { request, store } = setup();
    const input = { name: "Disposable draft", requestId: crypto.randomUUID() };
    const draft = await (await request("", "POST", input)).json() as RuleRecord;
    expect((await request(`/${draft.id}`, "DELETE", { revision: 2 })).status).toBe(409);
    expect((await request(`/${draft.id}`, "DELETE", { revision: 1 })).status).toBe(200);
    expect((await request(`/${draft.id}`)).status).toBe(404);
    expect((await store.rules.audit(draft.id)).map(event => event.action)).toEqual(["RULE_CREATED", "RULE_DELETED"]);
    const retry = await request("", "POST", input);
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: "RULE_REQUEST_DELETED" });
    expect(await store.rules.list()).toHaveLength(0);
  });
});


test("fixed Excel authoring rejects blank creation and direct field/option tampering", async () => {
  const { request, create, store } = setup();
  expect((await request("", "POST", { name: "Blank", requestId: crypto.randomUUID(), template: "blank" })).status).toBe(400);
  const draft = await create("Fixed profile");
  for (const mutate of [
    (d: RuleDefinition) => { d.sections[0]!.questions.pop(); },
    (d: RuleDefinition) => { d.sections.flatMap(s => s.questions).find(q => q.options.length)!.options[0]!.label = "Custom option"; },
    (d: RuleDefinition) => { d.calculations = []; },
    (d: RuleDefinition) => { d.scoring = []; },
    (d: RuleDefinition) => { d.issues = []; },
  ]) {
    const definition = structuredClone(draft.definition as RuleDefinition); mutate(definition);
    const result = await request(`/${draft.id}`, "PUT", { revision: 1, definition });
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: "FIXED_RULE_REQUIRED" });
  }
  expect((await store.rules.get(draft.id))!.revision).toBe(1);
  // Historical definitions remain readable; new authoring cannot use them as a bypass.
  const record = store.rules.records.find(r => r.id === draft.id)!;
  (record.definition as RuleDefinition).sections[0]!.questions.pop();
  expect((await request(`/${draft.id}`)).status).toBe(200);
  const list = await (await request("")).json();
  expect(list.versions[0]).toMatchObject({ editable: false, duplicable: false, deletable: true });
  expect((await request("", "POST", { name: "Legacy copy", requestId: crypto.randomUUID(), duplicateId: draft.id })).status).toBe(409);
  expect((await request(`/${draft.id}/validate`, "POST", { revision: 1 })).status).toBe(409);
});

test("custom score groups persist and invalid group edits cannot bypass integrity checks", async () => {
  const { request, create } = setup();
  const draft = await create("Score groups");
  const definition = structuredClone(draft.definition as RuleDefinition);
  definition.domains = definition.domains.filter(group => group.id === "unassigned");
  definition.domains.push({ id: "custom_group", label: "Custom group", cap: 9, sources: [] });
  definition.scoring.forEach(rule => { rule.domainId = "custom_group"; });
  const saved = await request(`/${draft.id}`, "PUT", { revision: 1, definition });
  expect(saved.status).toBe(200);
  const persisted = await (await request(`/${draft.id}`)).json() as RuleRecord;
  expect((persisted.definition as RuleDefinition).domains).toEqual(definition.domains);
  expect((persisted.definition as RuleDefinition).scoring.every(rule => rule.domainId === "custom_group")).toBe(true);

  for (const [mutate, expectedCode] of [
    [(d: RuleDefinition) => { d.domains.push({ id: "other_group", label: " CUSTOM GROUP ", cap: null, sources: [] }); }, "DUPLICATE_DOMAIN_NAME"],
    [(d: RuleDefinition) => { d.domains.push({ ...d.domains[1]!, label: "Different name" }); }, "DUPLICATE_ID"],
    [(d: RuleDefinition) => { d.domains.pop(); }, "MISSING_DOMAIN"],
  ] as const) {
    const invalid = structuredClone(definition); mutate(invalid);
    const result = await request(`/${draft.id}`, "PUT", { revision: 2, definition: invalid });
    expect(result.status).toBe(400);
    expect((await result.json()).issues.some((issue: { code: string }) => issue.code === expectedCode)).toBe(true);
  }
  definition.domains[0]!.cap = 5;
  const reserved = await request(`/${draft.id}`, "PUT", { revision: 2, definition });
  expect(reserved.status).toBe(409);
  expect(await reserved.json()).toEqual({ error: "FIXED_RULE_REQUIRED" });
});

test("default selection is explicit, active-only, audited and protects retirement", async () => {
  const context = setup();
  let first = await savedSynthetic(context, "First default");
  expect((await context.request(`/${first.id}/set-default`, "POST", { revision: first.revision })).status).toBe(409);
  for (const action of ["validate", "approve"] as const) first = await (await context.request(`/${first.id}/${action}`, "POST", { revision: first.revision })).json();
  expect((await context.request(`/${first.id}/set-default`, "POST", { revision: first.revision })).status).toBe(409);
  first = await (await context.request(`/${first.id}/activate`, "POST", { revision: first.revision, makeDefault: true })).json();
  expect(first.isDefault).toBe(true);
  expect((await context.request(`/${first.id}/retire`, "POST", { revision: first.revision })).status).toBe(409);
  let second = await savedSynthetic(context, "Second default");
  for (const action of ["validate", "approve", "activate"] as const) second = await (await context.request(`/${second.id}/${action}`, "POST", { revision: second.revision })).json();
  expect(second.isDefault).toBe(false);
  expect((await context.request(`/${second.id}/set-default`, "POST", { revision: 1 })).status).toBe(409);
  second = await (await context.request(`/${second.id}/set-default`, "POST", { revision: second.revision })).json();
  expect(second.isDefault).toBe(true);
  expect((await context.store.rules.get(first.id))?.isDefault).toBe(false);
  expect((await context.store.overview()).versions.filter(v => v.isDefault).map(v => v.id)).toEqual([second.id]);
  const list = await (await context.request("")).json();
  expect(list.versions.filter((v: RuleRecord) => v.isDefault).map((v: RuleRecord) => v.id)).toEqual([second.id]);
  expect(await context.store.rules.audit(second.id)).toContainEqual(expect.objectContaining({ action: "RULE_DEFAULT_SET", actor: actorId, at: now }));
  expect(await context.store.rules.audit(first.id)).toContainEqual(expect.objectContaining({ action: "RULE_DEFAULT_REPLACED", actor: actorId, at: now }));
  expect((await context.request(`/${first.id}/retire`, "POST", { revision: first.revision })).status).toBe(200);
});
