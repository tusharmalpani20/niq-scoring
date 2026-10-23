import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { createApp } from "./app";
import { MemoryReportContentJobStore } from "./report-content-job-store";
import { MemoryScoringStore } from "./store";
import { MemoryReportTraceStore } from "./report-trace-store";
import { MemoryReportGenerationStore, REPORT_RUN_LEASE_MS } from "./report-generation-store";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { createEntityId } from "./lib/id";
import { ruleChecksum } from "./rule-routes";
import { ReportModelError, type ReportTextProvider } from "./openrouter-report-client";
import { plainNarrative } from "./report-highlights";
import { matchedReportPacket, normalizeNarrativePunctuation, reportEvidence, validateNarrative, type ReportContentRequest } from "./report-content";
import { buildDeterministicReportFallback } from "./report-fallback";
import { resolveCarePlanGuidance } from "@niq-scoring/contracts/care-plan-resolver";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";

const safePart = { text: "The NIQ risk category needs clinician review.", evidenceIds: ["fact:niq_risk"] };
const omittedPart = { text: "", evidenceIds: [] as string[] };
const defaultNutritionPart = { text: "Maintain nutrition and monitor appetite during treatment.", evidenceIds: ["rule:nutrition:nutrition_low"] };
const safeNarrative = { overview: safePart, keyFindings: safePart, actionSummary: safePart, monitoringSummary: safePart, overallSummary: safePart,
  nutritionAdvice: defaultNutritionPart, treatmentAdvice: omittedPart, conditionAdvice: omittedPart, effectsAdvice: omittedPart,
  foodSafetyAdvice: omittedPart, redFlagsAdvice: omittedPart };
const emptyNarrative = { overview: omittedPart, keyFindings: omittedPart, actionSummary: omittedPart, monitoringSummary: omittedPart,
  overallSummary: { text: "Nutrition risk was reviewed.", evidenceIds: ["fact:niq_risk"] }, nutritionAdvice: omittedPart, treatmentAdvice: omittedPart, conditionAdvice: omittedPart,
  effectsAdvice: omittedPart, foodSafetyAdvice: omittedPart, redFlagsAdvice: omittedPart };
const noGuidanceNarrative = emptyNarrative;
const usage = { model: "openai/gpt-6-luna", provider: "test-provider", generationId: "gen-test", promptTokens: 120, completionTokens: 40, reasoningTokens: 5, costUsd: 0.001, latencyMs: 10 };
type Step = "writer" | "reviewer" | "revision" | "coverage" | "summarizer" | "highlighter";
const plainPart = (part: { text: string; evidenceIds: string[] }) => ({ ...part, text: part.text.replaceAll("**", "") });

function fixtureHighlights(user: string): { points: Array<{ id: string; phrases: Array<{ phrase: string; kind: "finding" | "action" }> }> } | { sections: unknown[] } {
  const payload = JSON.parse(user) as { sections?: Array<{ section: string; points: Array<{ id: string; text: string }> }>; section: string; points: Array<{ id: string; text: string }> };
  if (payload.sections) return { sections: payload.sections.map(section => ({ section: section.section,
    ...fixtureHighlights(JSON.stringify(section)) })) };
  const { points } = payload;
  return { points: points.map(({ id, text }) => {
    const actionVerb = /\b(?:aim|ask|avoid|call|check|choose|contact|discuss|follow|keep|maintain|monitor|record|report|seek|separate|share|take|tell|track|use)\b/i;
    const sentences = Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(text), item => item.segment);
    const choices: Array<{ phrase: string; kind: "finding" | "action" }> = [];
    for (const sentence of sentences) {
      const words = Array.from(sentence.matchAll(/[\p{L}]+(?:[’'-][\p{L}]+)*/gu));
      if (words.length < 3) continue;
      const actionStart = words.findIndex(word => actionVerb.test(word[0]));
      const starts = [...new Set([...(actionStart >= 0 ? [actionStart] : []), ...words.map((_, index) => index)])];
      for (const start of starts) {
        if (start > words.length - 3) continue;
        const last = Math.min(start + 7, words.length) - 1;
        const phrase = sentence.slice(words[start]!.index, words[last]!.index + words[last]![0].length);
        if (text.indexOf(phrase) === text.lastIndexOf(phrase)
          && !choices.some(choice => sentence.includes(choice.phrase) && phrase.includes(choice.phrase))) {
          choices.push({ phrase, kind: actionVerb.test(phrase) ? "action" : "finding" });
          break;
        }
      }
      if (choices.length === 3) break;
    }
    return { id, phrases: choices };
  }) };
}

function fixtureManager(system: string, user: string, schema: Record<string, unknown>) {
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (properties?.sources) {
    const { evidence } = JSON.parse(user) as { evidence: Array<{ id: string; text: string }> };
    return { sources: evidence.map(source => {
      const card = source.id.startsWith("possible:toxicity:");
      const product = /^(?:rule:product:|catalog:product:)/u.test(source.id);
      return { evidenceId: source.id, actions: source.id.startsWith("fact:") ? [] : [{
        action: source.text, qualification: "", sourceQuote: source.text,
        destination: card ? "possibleEffectCard" : product ? "structuredProductPlan" : "nutritionAdvice",
        cardEvidenceId: card ? source.id : null, stage: card ? "card" : product ? "assembled" : "narrative",
      }] };
    }) };
  }
  if (properties?.resolutions) {
    const { conflicts } = JSON.parse(user);
    return { resolutions: conflicts.map((row: any) => ({ nutrient: row.nutrient, decision: "withhold_numeric", selectedSourceId: null,
      rationale: "The fixture provides no justified source precedence, so the disputed target is individualised." })) };
  }
  if ((properties?.assignments as any)?.items?.properties?.unitId) return { assignments: JSON.parse(user).units.map((unit: any) => ({
    unitId: unit.unitId, destination: unit.evidenceId.startsWith("possible:toxicity:") ? "possibleEffectCard"
      : /^(?:rule:product:|catalog:product:)/u.test(unit.evidenceId) ? "structuredProductPlan" : "nutritionAdvice",
    cardEvidenceId: unit.evidenceId.startsWith("possible:toxicity:") ? unit.evidenceId : null,
  })) };
  if (properties?.assignments) return { assignments: ["writer", "reviewer", "coverage", "summarizer", "highlighter"].map(role => ({ role })) };
  if (system.includes("Adjudicate only the completeness auditor")) return fixtureCoverage(user);
  if (properties?.retainedIssueIndexes) {
    const issues = user.match(/Indexed concerns: (\[[\s\S]*?\])(?:\n|$)/)?.[1];
    return { retainedIssueIndexes: issues ? (JSON.parse(issues) as Array<{ index: number }>).map(issue => issue.index) : [] };
  }
  if (properties?.decision) return { decision: "approve", issues: [] };
  if (properties?.accepted) return { accepted: true, issues: [] };
  throw new Error(`Unexpected manager fixture schema: ${system}`);
}

function fixtureCoverage(user: string) {
  const source = user.match(/(?:Candidate source rows|Source rows): (\[[\s\S]*?\])\n/)?.[1];
  if (!source) throw new Error("Coverage fixture could not find source rows");
  const rows = JSON.parse(source) as Array<{ id?: string; evidenceId?: string }>;
  return { rows: rows.map(row => ({ evidenceId: row.id ?? row.evidenceId!, covered: true, missing: [] })) };
}

/** Translate legacy fixture prose to the provider's precise-edit contract. This
 * is test scaffolding only: production still validates every exact anchor.
 */
function fixturePatches(user: string, response: unknown) {
  if (!response || typeof response !== "object" || "edits" in response) return response;
  const current = user.match(/Current draft: ([^\n]+)\n/)?.[1];
  if (!current) throw new Error("Patch fixture needs the current draft");
  const draft = JSON.parse(current) as Record<string, { text: string; evidenceIds: string[] }>;
  const concernText = user.match(/Issues: ([^\n]+)\n/)?.[1]
    ?? user.match(/Missing meanings: ([^\n]+)\n/)?.[1] ?? "[]";
  const concerns = JSON.parse(concernText) as Array<{ field?: string; code?: string }>;
  const fields = [...new Set(concerns.map(issue => issue.field ?? issue.code?.split(":")[0])
    .filter((field): field is string => Boolean(field && draft[field])))];
  const part = response as { text?: string; evidenceIds?: string[] };
  const targets = "text" in part
    ? { [fields[0] ?? Object.keys(draft)[0]!]: part as { text: string; evidenceIds: string[] } }
    : response as typeof draft;
  const edits = Object.entries(targets).filter(([field, target]) => draft[field] && (!fields.length || fields.includes(field))
    && target.text !== draft[field]!.text).map(([field, target]) => {
    const old = draft[field]!.text;
    let prefix = 0;
    while (prefix < old.length && prefix < target.text.length && old[prefix] === target.text[prefix]) prefix++;
    let suffix = 0;
    while (suffix < old.length - prefix && suffix < target.text.length - prefix
      && old[old.length - 1 - suffix] === target.text[target.text.length - 1 - suffix]) suffix++;
    // Add neighbouring context when a pure insertion or repeated substring
    // would otherwise leave an ambiguous anchor.
    while (old.length && (prefix === old.length - suffix
      || old.indexOf(old.slice(prefix, old.length - suffix)) !== old.lastIndexOf(old.slice(prefix, old.length - suffix)))) {
      if (prefix > 0) prefix--;
      else if (suffix > 0) suffix--;
      else break;
    }
    const find = old.slice(prefix, old.length - suffix);
    if (find.length > 500) throw new Error("Fixture replacement exceeds the precise anchor budget");
    return { field, find, replace: target.text.slice(prefix, target.text.length - suffix), evidenceIds: target.evidenceIds };
  });
  return { edits };
}

async function setup(handler: (step: Step, call: number, user: string, system: string) => unknown = step => step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative,
  configure?: (definition: FinalAssessmentDefinition) => void, runs = new MemoryReportGenerationStore(),
  highlighter?: (user: string) => unknown, coverageAuditor?: (user: string) => unknown,
  summarizer?: (user: string) => unknown | Promise<unknown>, planner?: () => unknown,
  jobs = new MemoryReportContentJobStore()) {
  const store = new MemoryScoringStore();
  const definition = createFinalAssessmentTemplate("Report test");
  configure?.(definition);
  const rule = { id: createEntityId(), version: "Report test", lifecycle: "ACTIVE" as const, clinicalUsePermitted: true, definition,
    packageChecksum: ruleChecksum(definition), revision: 1, validatedRevision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", createdBy: null, approvedAt: "2026-01-01T00:00:00Z" };
  store.rules.records.push(rule);
  await store.rules.setDefault({ id: rule.id, revision: rule.revision, actor: "test", now: rule.createdAt });
  const client = await store.createClient({ name: "Report test client" });
  const deployment = await store.createDeployment({ clientId: client.id, name: "Report test deployment", environment: "test" });
  await store.setEntitlement(deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: null });
  await store.assignVersion(deployment.id, { mode: "LATEST_APPROVED" });
  const token = `niq_dep_report123456.${"a".repeat(40)}`;
  store.credentials.push({ credentialId: createEntityId(), clientId: client.id, deploymentId: deployment.id, keyPrefix: "report123456", secretHash: new Bun.CryptoHasher("sha256").update(token).digest("hex") });
  const facts: ReportContentRequest["facts"] = { reviewedScore: 12, reviewedRiskCategoryId: "low", treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], assessmentDate: "2026-01-02", observations: [{ id: "current_weight_kg", label: "Current weight", value: "68.4", unit: "kg" }] };
  const guidance = matchedReportPacket(definition, facts, "low", facts.assessmentDate, await store.products.list());
  const evidence = reportEvidence(definition, facts, { id: "low", label: "Low Risk" }, guidance);
  const verifiedFixture = buildDeterministicReportFallback({ facts, classification: { id: "low", label: "Low Risk" }, guidance, evidence }).narrative;
  let calls = 0;
  const provider: ReportTextProvider = { complete: async ({ step, user, system, schema }) => ({
    content: step === "coverage" ? await (coverageAuditor?.(user) ?? fixtureCoverage(user))
      : step === "highlighter"
      ? highlighter?.(user) ?? fixtureHighlights(user)
      : step === "manager" ? planner && (schema.properties as any).assignments && (schema.properties as any).assignments.items?.properties?.unitId ? planner() : fixtureManager(system, user, schema)
      : step === "summarizer" ? await (summarizer?.(user) ?? fixtureSummaries(user))
      : await (async () => {
        const result = await handler(step, ++calls, user, system);
        const selected = result === safeNarrative ? verifiedFixture : result;
        return (schema.properties as Record<string, unknown> | undefined)?.edits ? fixturePatches(user, selected) : selected;
      })(), usage,
  }) };
  let jobTick!: () => Promise<void>;
  const traces = new MemoryReportTraceStore(runs);
  const authStore = new MemoryAdminAuthStore();
  const app = createApp({ store, authStore, reportContentJobStore: jobs, onReportJobTick: tick => { jobTick = tick; }, reportGenerationStore: runs, reportTraceStore: traces, reportTextProvider: provider,
    region: "test", allowedOrigins: [], runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => new Date("2026-01-02T00:00:00Z") });
  const call = (action: string, data: unknown) => app.request(`/v1/assessments/${action}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(data) });
  await call("start", { assessmentReference: "report-assessment" });
  const reviewed = await (await call("classify-reviewed", { assessmentReference: "report-assessment", idempotencyKey: "reviewed-result-1", score: 12 })).json();
  const resultReference = reviewed.result.resultReference as string;
  const request = (overrides: Record<string, unknown> = {}) => ({ assessmentReference: "report-assessment", resultReference, idempotencyKey: "report-run-1", facts, ...overrides });
  return { app, call, store, jobs, jobTick, token, runs, traces, authStore, rule, request, facts, verifiedFixture, getCalls: () => calls };
}

function fixtureSummaries(user: string) {
  return { rows: (JSON.parse(user.match(/Source rows: (\[[\s\S]*?\])\nPatient safety context/)?.[1] ?? "[]") as Array<{ id: string; text: string }>).map(row => ({
    evidenceId: row.id, text: `If this possible effect occurs, discuss nutrition care with your team. ${row.text.replace(/^.*Source guidance: /, "")}`,
  })) };
}

test("report content uses pinned rules, eleven bounded fields, idempotency, and sanitized admin usage", async () => {
  const { app, call, runs, request, rule, verifiedFixture, getCalls } = await setup();
  const response = await call("report-content", request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: "READY", ruleVersionId: rule.id, checksum: rule.packageChecksum });
  expect(plainNarrative(body.narrative)).toEqual(plainNarrative(verifiedFixture));
  expect(getCalls()).toBe(2);
  expect(await (await call("report-content", request())).json()).toEqual(body);
  expect(getCalls()).toBe(2);
  expect((await call("report-content", request({ facts: { ...request().facts, reviewedScore: 13 } }))).status).toBe(409);
  const listing = await runs.list({ page: 1, pageSize: 20 });
  expect(listing.items[0]?.calls.map(call => call.step)).toContain("manager");
  expect(listing.items[0]?.calls.map(call => call.step)).toContain("highlighter");
  const serialized = JSON.stringify(listing);
  expect(serialized).not.toContain("Current weight");
  expect(serialized).not.toContain("68.4");
  expect(serialized).not.toContain(safePart.text);
  expect(serialized).not.toContain("writerPrompt");
  expect((await app.request("/v1/assessments/report-content", { method: "POST", body: JSON.stringify(request()) })).status).toBe(401);
});

test("a separate post-review pass adds only exact emphasis to approved prose", async () => {
  const requested: string[] = [];
  const { call, request, runs } = await setup(undefined, undefined, undefined, user => {
    const parsed = JSON.parse(user) as { sections: Array<{ section: string; points: Array<{ id: string; text: string }> }> };
    for (const section of parsed.sections) {
      requested.push(section.section);
      expect(section.points.every(point => point.id && point.text)).toBe(true);
    }
    return fixtureHighlights(user);
  });
  const response = await call("report-content", request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.narrative.overview.text).toBe("");
  expect(body.narrative.nutritionAdvice.text).toContain("**");
  expect(requested).toContain("nutritionAdvice");
  expect((await runs.list({ page: 1, pageSize: 10 })).items[0]?.calls.some(call => call.step === "highlighter")).toBe(true);
});

test("highlighting waits until coverage and final clinical approval complete", async () => {
  let releaseCoverage!: () => void;
  let coverageStarted!: () => void;
  let highlighted = false;
  const released = new Promise<void>(resolve => { releaseCoverage = resolve; });
  const coverageEntered = new Promise<void>(resolve => { coverageStarted = resolve; });
  const { call, request } = await setup(undefined, undefined, undefined, user => {
    highlighted = true;
    return fixtureHighlights(user);
  }, async user => { coverageStarted(); await released; return fixtureCoverage(user); });
  const response = call("report-content", request());
  try { await coverageEntered; expect(highlighted).toBe(false); }
  finally { releaseCoverage(); }
  const body = await (await response).json();
  expect(body.status).toBe("READY");
  expect(body.model).not.toBe("rule-fallback");
  expect(highlighted).toBe(true);
});

test("coverage does not require removed supplement suitability advice", async () => {
  const { call, request, runs } = await setup(undefined, undefined, undefined, undefined, user => {
    const result = fixtureCoverage(user);
    return { rows: result.rows.map(row => ({ ...row, covered: false,
      missing: ["[nutritionAdvice] The removed supplement-suitability request is missing."] })) };
  });
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.narrative.nutritionAdvice.text).not.toMatch(/ask .*supplement|consider .*supplement/i);
  expect((await runs.list({ page: 1, pageSize: 10 })).items[0]?.calls.some(call => call.step === "highlighter")).toBe(true);
});

test("the manager adjudicates a covered nutrition source without adding removed supplement advice", async () => {
  let audited = 0;
  const { call, request, runs } = await setup((step, _call, user) =>
    step === "reviewer" ? { accepted: true, issues: [] }
      : step === "revision" && user.includes("An independent audit found missing meaning")
        ? { text: "Discuss an oral nutrition supplement with your care team if intake falls.",
          evidenceIds: ["rule:nutrition:nutrition_low"] }
        : safeNarrative, undefined, undefined, undefined, user => {
    const result = fixtureCoverage(user);
    return ++audited === 1
      ? { rows: result.rows.map(row => ({ ...row, covered: false, missing: ["[nutritionAdvice] Add oral nutrition supplement advice."] })) }
      : result;
  });
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.narrative.nutritionAdvice.text).not.toMatch(/oral nutrition supplement if intake falls/i);
  expect(audited).toBe(1);
  expect((await runs.list({ page: 1, pageSize: 10 })).items[0]?.calls.some(call => call.step === "manager")).toBe(true);
  expect((await runs.list({ page: 1, pageSize: 10 })).items[0]?.calls.some(call => call.step === "coverage")).toBe(true);
});

test("invalid batched highlight suggestions recover locally without another model call", async () => {
  let attempts = 0;
  const { call, request } = await setup(undefined, undefined, undefined, user => {
    attempts++;
    if (attempts !== 1) return fixtureHighlights(user);
    const parsed = JSON.parse(user) as { sections: Array<{ section: string; points: Array<{ id: string }> }> };
    return { sections: parsed.sections.map(section => ({ section: section.section,
      points: section.points.map(point => ({ id: point.id,
        phrases: [{ phrase: "start an unsupported treatment", kind: "action" }] })) })) };
  });
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.narrative.nutritionAdvice.text).toContain("**");
  expect(attempts).toBe(1);
  expect(body.narrative.nutritionAdvice.text).not.toContain("start an unsupported treatment");
});

test("a failed model pass recovers factual interpretation without forcing emphasis", async () => {
  let attempts = 0;
  const { call, request } = await setup(undefined, undefined, undefined, () => {
    attempts++;
    return {};
  });
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.narrative.keyFindings.text.replaceAll("**", "")).toContain("Your NIQ score of 12 indicates low risk.");
  expect(body.narrative.keyFindings.evidenceIds).toContain("fact:niq_risk");
  expect(attempts).toBe(1);
});

test("an expired writer cannot publish over a retry with the same idempotency key", async () => {
  let time = new Date("2026-01-02T00:00:00Z");
  const runs = new MemoryReportGenerationStore(() => time);
  let started!: () => void;
  let release!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const firstReleased = new Promise<void>(resolve => { release = resolve; });
  const { call, request } = await setup(async (step, invocation) => {
    if (step === "writer" && invocation === 1) { started(); await firstReleased; }
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, undefined, runs);
  const first = call("report-content", request());
  await firstStarted;
  time = new Date(time.getTime() + REPORT_RUN_LEASE_MS + 1);
  const retried = await call("report-content", request());
  expect(retried.status).toBe(200);
  const published = await retried.json();
  expect(published.status).toBe("READY");
  release();
  const stale = await first;
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: "REQUEST_IN_PROGRESS" });
  expect(await (await call("report-content", request())).json()).toEqual(published);
  const listing = await runs.list({ page: 1, pageSize: 10 });
  expect(listing.items[0]?.calls.filter(call => call.step === "writer")).toHaveLength(1);
  expect(listing.items[0]?.calls.some(call => call.step === "manager")).toBe(true);
});

test("report content requires the completed assessment date", async () => {
  const { call, request, facts, getCalls } = await setup();
  const { assessmentDate: _date, ...undated } = facts;
  expect((await call("report-content", request({ facts: undated }))).status).toBe(400);
  expect(getCalls()).toBe(0);
});

test("the reviewer receives independent fixed checks beyond editable wording", async () => {
  const systems: Record<string, string> = {};
  const prompts: Record<string, string> = {};
  const { call, request } = await setup((step, _call, _user, system) => {
    systems[step] = system;
    prompts[step] = _user;
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  expect((await call("report-content", request())).status).toBe(200);
  expect(systems.reviewer).toContain("Independently check claims against cited source text");
  expect(systems.reviewer).toContain("does not establish that condition");
  expect(systems.reviewer).toContain("Do not require excluded named-drug guidance or removed supplement suitability prompts");
  expect(systems.reviewer).toContain("three hash signs followed by the supported condition name");
  expect(prompts.writer).toContain("Write the eleven schema fields");
  expect(prompts.writer).toContain("conditionAdvice covers each matched comorbidity");
  expect(prompts.writer).toContain("foodSafetyAdvice owns food handling");
});

test("rule evidence IDs remain distinct when different rule groups reuse an ID", () => {
  const definition = createFinalAssessmentTemplate("Duplicate source IDs");
  const product = definition.carePlanGuidance!.products.plans[0]!;
  const facts = {
    reviewedScore: 12, reviewedRiskCategoryId: "low", treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [],
    assessmentDate: "2026-01-12", treatmentStatusId: "treatment_status_newly_diagnosed", cancerTypeId: "cancer_1",
    plannedTreatmentStartDate: "2026-01-20", observations: [],
  };
  const initiallyMatched = matchedReportPacket(definition, facts, "low", facts.assessmentDate);
  const matchedNutritionId = initiallyMatched.nutritionInterventions[0]!.id;
  definition.reportGuidance!.nutrition.find(row => row.id === matchedNutritionId)!.id = product.id;
  const packet = matchedReportPacket(definition, facts, "low", facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, { id: "low", label: "Low Risk" }, packet);
  expect(packet.nutritionInterventions.length).toBeGreaterThan(0);
  expect(packet.carePlan.products.plans.length).toBeGreaterThan(0);
  expect(new Set(evidence.map(item => item.id)).size).toBe(evidence.length);
  expect(evidence.some(item => item.id === `rule:nutrition:${product.id}`)).toBe(true);
  expect(evidence.some(item => item.id === `rule:product:${product.id}`)).toBe(true);
});

test("a passage beyond the writing guide remains available for review", async () => {
  const lengthy = { ...safeNarrative, overview: { text: `${Array(81).fill("review").join(" ")} The NIQ risk category needs clinician review.`, evidenceIds: ["fact:niq_risk"] } };
  const { call, request, getCalls } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] } : lengthy);
  const response = await call("report-content", request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("READY");
  expect(plainPart(body.narrative.overview)).toEqual(lengthy.overview);
  expect(body.omittedNarrativeFields).not.toContain("overview");
  expect(getCalls()).toBe(2);
});

test("care plan passages require matching rule evidence and copied guidance is rejected", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 27" },
    { id: "rule:nutrition:row1", text: "Begin nutrition support early. Adjust the plan based on treatment tolerance." },
    { id: "rule:comorbidity:row2", text: "Hypertension: Use lower-sodium food choices during treatment." },
  ];
  const good = { ...emptyNarrative,
    nutritionAdvice: { text: "Start nutrition support early. Adjust the plan during treatment.", evidenceIds: ["rule:nutrition:row1"] },
    conditionAdvice: { text: "### Hypertension\nChoose lower-sodium foods during treatment.", evidenceIds: ["rule:comorbidity:row2"] },
  };
  expect(validateNarrative(good, evidence).issues).toEqual([]);
  const unsupported = { ...good, conditionAdvice: { ...good.conditionAdvice, evidenceIds: ["fact:niq_risk"] } };
  expect(validateNarrative(unsupported, evidence).issues).toContain("conditionAdvice:MISSING_MATCHED_GUIDANCE");
  const copied = { ...good, nutritionAdvice: { text: evidence[1]!.text, evidenceIds: ["rule:nutrition:row1"] } };
  expect(validateNarrative(copied, evidence).issues).toContain("nutritionAdvice:COPIED_GUIDANCE");
  const longerRule = `${evidence[1]!.text} ${Array(30).fill("Continue discussing the plan with your care team").join(". ")}`;
  const sharedShortPhrase = longerRule.split(/\s+/u).slice(0, 14).join(" ");
  expect(validateNarrative({ ...good, nutritionAdvice: { text: sharedShortPhrase, evidenceIds: ["rule:nutrition:row1"] } },
    [{ ...evidence[1]!, text: longerRule }]).issues).not.toContain("nutritionAdvice:COPIED_GUIDANCE");
});

test("exception advice keeps the full name of a different product", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: Low Risk; reviewed score 12" },
    { id: "rule:nutrition:nutrition_low", text: "Maintain nutrition and monitor appetite during treatment." },
    { id: "rule:exception:pancreatic", text: "Pancreatic cancer: Remove Es Fortitude Nourish from the product plan." },
  ];
  const shortened = { ...emptyNarrative, treatmentAdvice: {
    text: "Nourish is not recommended for pancreatic cancer.", evidenceIds: ["rule:exception:pancreatic"],
  } };
  expect(validateNarrative(shortened, evidence).issues).toContain("treatmentAdvice:SHORTENED_EXCEPTION_PRODUCT");
  const full = { ...shortened, treatmentAdvice: { ...shortened.treatmentAdvice,
    text: "Es Fortitude Nourish is not recommended for pancreatic cancer." } };
  expect(validateNarrative(full, evidence).issues).not.toContain("treatmentAdvice:SHORTENED_EXCEPTION_PRODUCT");
});

test("matched conditions and treatment effects cannot be silently omitted", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 27" },
    { id: "rule:comorbidity:kidney", text: "Kidney disease: Individualize fluid and protein targets according to renal function." },
    { id: "rule:comorbidity:diabetes", text: "Diabetes: Review meal timing with the care team." },
    { id: "rule:toxicity:diarrhoea", text: "For reported diarrhoea, use the matched fluid advice and contact the team if it persists." },
  ];
  const missing = validateNarrative(noGuidanceNarrative, evidence).issues;
  expect(missing).toContain("conditionAdvice:MISSING_MATCHED_COVERAGE");
  expect(missing).toContain("effectsAdvice:MISSING_MATCHED_COVERAGE");
  const partial = { ...noGuidanceNarrative,
    conditionAdvice: { text: "### Kidney disease\nAsk your care team to set fluid and protein targets for your renal function.", evidenceIds: ["rule:comorbidity:kidney"] },
    effectsAdvice: { text: "Contact the team if diarrhoea persists.", evidenceIds: ["rule:toxicity:diarrhoea"] },
  };
  expect(validateNarrative(partial, evidence).issues).toContain("conditionAdvice:MISSING_MATCHED_COVERAGE");
  expect(validateNarrative({ ...partial, conditionAdvice: { text: "### Kidney disease\nAsk your care team to set fluid and protein targets for your renal function.\n### Diabetes\nAsk your diabetes team about meal timing.", evidenceIds: ["rule:comorbidity:kidney", "rule:comorbidity:diabetes"] } }, evidence).issues).toEqual([]);
});

test("reported effects can use matched treatment-status guidance without a drug class", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 27" },
    { id: "fact:assessment_symptoms_mouth_sores", text: "Assessment records symptoms: mouth sores. This does not establish a treatment cause." },
    { id: "rule:status:radiation", text: "Radiation status guidance: soft moist foods can help with mouth sores. Review swallowing difficulty with the team." },
  ];
  const narrative = { ...noGuidanceNarrative,
    treatmentAdvice: { text: "Review nutrition during radiation with your care team.", evidenceIds: ["rule:status:radiation"] },
    effectsAdvice: { text: "For your reported mouth sores, try soft, moist foods.", evidenceIds: ["rule:status:radiation", "fact:assessment_symptoms_mouth_sores"] },
  };
  expect(validateNarrative(narrative, evidence).issues).toEqual([]);
  expect(validateNarrative({ ...narrative, effectsAdvice: { ...narrative.effectsAdvice, evidenceIds: ["rule:status:radiation"] } }, evidence).issues)
    .toContain("effectsAdvice:STATUS_GUIDANCE_NEEDS_REPORTED_EFFECT");
});

test("reported radiation symptoms can use matched treatment guidance without treating it as a symptom fact", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 27" },
    { id: "fact:assessment_gastrointestinal_symptoms_dysphagia", text: "Assessment records dysphagia. This does not establish a treatment cause." },
    { id: "fact:assessment_gastrointestinal_symptoms_mouth_ulcers", text: "Assessment records mouth ulcers. This does not establish a treatment cause." },
    { id: "rule:treatment:radiotherapy_severely_malnourished", text: "For dysphagia, review swallowing safety with the team before changing food texture or fluid consistency. For mouth ulcers, consider soft moist foods." },
  ];
  const narrative = { ...noGuidanceNarrative,
    treatmentAdvice: { text: "Review nutrition during radiotherapy with your care team.", evidenceIds: ["rule:treatment:radiotherapy_severely_malnourished"] },
    effectsAdvice: { text: "For reported swallowing difficulty, review swallowing safety with your care team before changing texture. Soft moist foods may ease reported mouth ulcers.",
      evidenceIds: ["rule:treatment:radiotherapy_severely_malnourished", "fact:assessment_gastrointestinal_symptoms_dysphagia", "fact:assessment_gastrointestinal_symptoms_mouth_ulcers"] },
  };
  expect(validateNarrative(narrative, evidence).issues).toEqual([]);
  expect(validateNarrative({ ...narrative, effectsAdvice: { ...narrative.effectsAdvice,
    evidenceIds: ["rule:treatment:radiotherapy_severely_malnourished"] } }, evidence).issues)
    .toContain("effectsAdvice:TREATMENT_GUIDANCE_NEEDS_REPORTED_EFFECT");
  expect(validateNarrative({ ...narrative, effectsAdvice: { ...narrative.effectsAdvice,
    evidenceIds: ["fact:assessment_gastrointestinal_symptoms_dysphagia"] } }, evidence).issues)
    .toContain("effectsAdvice:MISSING_MATCHED_GUIDANCE");
});

test("matched nutrition and treatment advice cannot vanish from a ready report", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 31" },
    { id: "rule:nutrition:high", text: "Begin medically supervised nutrition support early." },
    { id: "rule:status:poor", text: "Preserve lean body mass during treatment." },
    { id: "rule:treatment:therapy", text: "Use small frequent meals to support intake." },
    { id: "rule:class:platinum", text: "Monitor hydration during treatment." },
    { id: "rule:product:selected", text: "Selected product plan: Invigour + Protect. Dose: 3 Invigour + 2 Protect." },
  ];
  const missing = validateNarrative(emptyNarrative, evidence).issues;
  expect(missing).toContain("nutritionAdvice:MISSING_MATCHED_COVERAGE");
  expect(missing).toContain("treatmentAdvice:MISSING_MATCHED_COVERAGE");
  const covered = { ...emptyNarrative,
    nutritionAdvice: { text: "Begin supervised support early to preserve muscle.", evidenceIds: ["rule:nutrition:high"] },
    treatmentAdvice: { text: "Preserve muscle with small frequent meals and monitor hydration.", evidenceIds: ["rule:status:poor", "rule:treatment:therapy", "rule:class:platinum"] },
    actionSummary: { text: "Take 3 Invigour and 2 Protect daily.", evidenceIds: ["rule:product:selected"] },
  };
  expect(validateNarrative(covered, evidence).issues).toContain("actionSummary:REPEATS_PRODUCT_PLAN");
  expect(validateNarrative({ ...covered, actionSummary: omittedPart }, evidence).issues).toEqual([]);
});

test("weight evidence states direction and avoids inventing a time interval", () => {
  const definition = createFinalAssessmentTemplate("Weight direction");
  const facts = { reviewedScore: 12, treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [],
    assessmentDate: "2026-01-12", assessmentAnswers: { previous_weight_kg: 67, current_weight_kg: 63 }, observations: [] };
  const packet = matchedReportPacket(definition, facts, "low", facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, { id: "low", label: "Low Risk" }, packet);
  expect(evidence.find(row => row.id === "fact:weight_direction")?.text).toContain("Recorded weight loss: 67 kg previously and 63 kg currently (6%).");
  expect(evidence.find(row => row.id === "fact:weight_direction")?.text).toContain("The previous weight was reported for 1 month ago.");
});

test("recorded cancer diagnosis is available to the summary writer", () => {
  const definition = createFinalAssessmentTemplate("Diagnosis evidence");
  const facts = { reviewedScore: 12, treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [],
    cancerTypeId: "cancer_6", assessmentDate: "2026-01-12", observations: [] };
  const packet = matchedReportPacket(definition, facts, "low", facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, { id: "low", label: "Low Risk" }, packet);
  expect(evidence.find(row => row.id === "fact:diagnosis")?.text).toBe("Recorded cancer diagnosis: Pancreatic cancer.");
});

test("the closing summary can cite recorded treatment context", () => {
  const definition = createFinalAssessmentTemplate("Summary facts");
  const facts = { reviewedScore: 23, treatmentTypeIds: ["current_cancer_treatment_chemotherapy"], drugClassIds: [], confirmedToxicityIds: [],
    assessmentDate: "2026-10-13", cancerTypeId: "cancer_6", treatmentStatusId: "treatment_status_newly_diagnosed", observations: [] };
  const packet = matchedReportPacket(definition, facts, "moderate", facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, { id: "moderate", label: "Moderate Risk" }, packet);
  expect(evidence.find(item => item.id === "fact:treatment_status")?.text).toContain("Newly Diagnosed");
  expect(evidence.find(item => item.id === "fact:treatment_type_current_cancer_treatment_chemotherapy")?.text).toContain("Chemotherapy");
  const summary = { ...noGuidanceNarrative, overallSummary: {
    text: "This assessment records moderate nutrition risk and current chemotherapy.",
    evidenceIds: ["fact:niq_risk", "fact:treatment_type_current_cancer_treatment_chemotherapy"],
  } };
  expect(validateNarrative(summary, evidence).issues).not.toContain("overallSummary:UNKNOWN_EVIDENCE_ID");
  for (const text of ["Follow the advice below.", "Watch for the listed warning signs."]) {
    expect(validateNarrative({ ...summary, overallSummary: { ...summary.overallSummary, text } }, evidence).issues)
      .toContain("overallSummary:POSITIONAL_REFERENCE");
  }
});

test("a missing closing summary is repaired before a report is ready", async () => {
  const missing = { ...safeNarrative, overallSummary: omittedPart };
  const { call, request } = await setup((step, _call, user) => {
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "revision" && user.includes("Repair only overallSummary")) return safePart;
    return missing;
  });
  const response = await call("report-content", request());
  const body = await response.json();
  expect(body.status).toBe("READY");
  expect(plainPart(body.narrative.overallSummary)).toEqual(safePart);
});

test("an unrepaired closing summary receives section fallback while other passages are retained", async () => {
  const missing = { ...safeNarrative, overallSummary: omittedPart };
  const { call, request } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] } : missing);
  const response = await call("report-content", request());
  const body = await response.json();
  expect(body.status).toBe("READY");
  expect(body.generationMode).toBe("SECTION_FALLBACK");
  expect(body.sectionOrigins.overallSummary).toBe("rule_fallback");
  expect(body.sectionOrigins.nutritionAdvice).toBe("agent");
  expect(plainPart(body.narrative.nutritionAdvice)).toEqual(defaultNutritionPart);
  expect(body.narrative.overallSummary.text).toBeTruthy();
});

test("HbA1c wording is excluded from every report narrative field", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 27" },
    { id: "rule:comorbidity:row1", text: "Review body composition, HbA1c, and lipids." },
  ];
  for (const term of ["HbA1c", "A1c", "glycated haemoglobin", "glycated hemoglobin"]) {
    const candidate = { ...safeNarrative, conditionAdvice: { text: `Review ${term} with the care team.`, evidenceIds: ["rule:comorbidity:row1"] } };
    expect(validateNarrative(candidate, evidence).issues).toContain("conditionAdvice:EXCLUDED_REPORT_TERM");
  }
});

test("an excluded term is removed through report revision before publication", async () => {
  const unsafe = { ...safeNarrative, monitoringSummary: { text: "Review HbA1c during treatment.", evidenceIds: ["fact:niq_risk"] } };
  const prompts: string[] = [];
  const { call, request, getCalls } = await setup((step, _call, _user, system) => {
    prompts.push(system);
    return step === "reviewer" ? { accepted: true, issues: [] } : step === "writer" ? unsafe : safeNarrative;
  });
  const response = await call("report-content", request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("READY");
  expect(JSON.stringify(body.narrative)).not.toMatch(/hba1c|\ba1c\b/i);
  expect(getCalls()).toBe(4);
  expect(prompts.every(system => system.includes("Do not mention HbA1c"))).toBe(true);
});

test("Other returns only generic nutrition guidance, never class toxicity or product plans", async () => {
  const { call, request, facts } = await setup();
  const response = await call("report-content", request({ facts: { ...facts, drugClassIds: ["other"] } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.nutritionInterventions.length).toBeGreaterThan(0);
  expect(body.guidance.toxicityInterventions).toEqual([]);
  expect(body.guidance.possibleToxicities).toEqual([]);
  expect(body.guidance.classGuidance).toEqual([]);
  expect(body.guidance.carePlan.products.plans).toEqual([]);
});

test("relative pre-conditioning advice avoids calendar windows in report evidence", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  const response = await call("report-content", request({ facts: {
    ...facts,
    assessmentDate: "2026-10-12",
    treatmentStatusId: "treatment_status_newly_diagnosed",
    plannedTreatmentStartDate: "2026-10-20",
    cancerTypeId: "cancer_1",
  } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.carePlan.products).toMatchObject({
    status: "selected",
    plans: [{ stage: "pre_conditioning", duration: "You can start these supplements 15 days before your treatment." }],
  });
  expect(writerInputs.at(-1)).toContain("fact:planned_treatment_start");
  expect(writerInputs.at(-1)).toContain("not confirmed as already underway");
  expect(writerInputs.at(-1)).toContain("Selected product plan: Invigour + Nourish. Dosage and preparation: Invigour: 1 per day. Nourish: 1 per day.");
});

test("writer receives the matched cart quantities and regimen instructions", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    const plan = definition.carePlanGuidance!.products.plans.find(row => row.id === "product_pre_conditioning_well_nourished")!;
    plan.items = [{ productName: "Invigour", quantityPerDay: 1, unit: "sachet", timesPerDay: 1,
      preparation: "Mix in water", mealTiming: "After breakfast" },
    { productName: "Nourish", quantityPerDay: 2, mealTiming: "After meals" }];
    plan.productNames = ["Invigour", "Nourish"];
    plan.dose = "1 Invigour (sachet) + 2 Nourish";
  });
  const response = await call("report-content", request({ facts: {
    ...facts, assessmentDate: "2026-10-12", treatmentStatusId: "treatment_status_newly_diagnosed",
    plannedTreatmentStartDate: "2026-10-20", cancerTypeId: "cancer_1",
  } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.carePlan.products.plans[0].items).toEqual([
    { productName: "Invigour", quantityPerDay: 1, unit: "sachet", timesPerDay: 1,
      preparation: "Mix in water", mealTiming: "After breakfast" },
    { productName: "Nourish", quantityPerDay: 2, mealTiming: "After meals" },
  ]);
  expect(body.guidance.carePlan.products.plans[0].durationAmount).toBe(15);
  expect(writerInputs.at(-1)).toContain("Invigour: 1 sachet per day; taken once per day; prepare: Mix in water; meal timing: After breakfast");
  expect(writerInputs.at(-1)).toContain("Nourish: 2 per day; meal timing: After meals");
});

test("a selected product carries its image to the response while agent prompts retain text only", async () => {
  const prompts: string[] = [];
  const { call, request, facts, store } = await setup((step, _call, user) => {
    prompts.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  const old = (await store.products.list()).find(product => product.name === "Invigour")!;
  await store.products.update(old.id, { name: "Es Invigour", description: "Nutrition support described in the supplied report", aliases: ["Invigour"], benefits: ["Supports energy and protein intake.", "Helps maintain muscle mass."], imageDataUrl: "data:image/png;base64,cHJpdmF0ZS1pbWFnZS1ieXRlcw==" });
  const response = await call("report-content", request({ facts: { ...facts, assessmentDate: "2026-10-12",
    treatmentStatusId: "treatment_status_newly_diagnosed", plannedTreatmentStartDate: "2026-10-20", cancerTypeId: "cancer_1" } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.carePlan.products.catalog).toContainEqual({ id: old.id, name: "Es Invigour", description: "Nutrition support described in the supplied report", aliases: ["Invigour"], benefits: ["Supports energy and protein intake.", "Helps maintain muscle mass."], imageDataUrl: "data:image/png;base64,cHJpdmF0ZS1pbWFnZS1ieXRlcw==" });
  expect(body.guidance.carePlan.products.plans[0].items[0].productName).toBe("Invigour");
  expect(prompts.at(-1)).toContain(`catalog:product:${old.id}`);
  expect(prompts.at(-1)).toContain("Product benefits only; dose and timing come from the selected plan.");
  expect(prompts.at(-1)).toContain("Supports energy and protein intake.");
  expect(body.guidance.carePlan.products.catalog.find((product: {id:string}) => product.id === old.id)?.imageDataUrl).toBe("data:image/png;base64,cHJpdmF0ZS1pbWFnZS1ieXRlcw==");
  expect(prompts.join(" ")).not.toContain("cHJpdmF0ZS1pbWFnZS1ieXRlcw==");
});

test("writer and reviewer receive the patient's diet preference", async () => {
  const prompts: Record<string, { user: string; system: string }> = {};
  const { call, request, facts } = await setup((step, _call, user, system) => {
    prompts[step] = { user, system };
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  expect((await call("report-content", request({ facts: { ...facts, dietPreferenceId: "jain" } }))).status).toBe(200);
  expect(prompts.writer?.user).toContain('"id":"fact:diet_preference","text":"Reported diet preference: Jain (no eggs, fish, or meat)"');
  expect(prompts.writer?.system).toContain("diet suggestions compatible with the recorded preference");
  expect(prompts.reviewer?.system).toContain("diet suggestions compatible with the recorded preference");
});

test("writer receives the sheet's Surgical scoop quantity without a made-up daily frequency", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  const response = await call("report-content", request({ facts: {
    ...facts, assessmentDate: "2026-10-12", surgicalStatusId: "cancer_surgical_status_done",
    surgeryDate: "2026-10-10", dietPreferenceId: "non_vegetarian",
  } }));
  expect(response.status).toBe(200);
  const plan = (await response.json()).guidance.carePlan.products.plans[0];
  expect(plan.items).toEqual([{ productName: "Liss WH", quantityPerDay: 1, unit: "level scoop", preparation: "Mix in 150 mL water." }]);
  expect(writerInputs.at(-1)).toContain("Liss WH: 1 level scoop per day; prepare: Mix in 150 mL water.");
  expect(writerInputs.at(-1)).not.toContain("Liss WH: undefined per day");
});

test("writer receives only the product plan after matched structured exceptions", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    const plan = definition.carePlanGuidance!.products.plans.find(row => row.id === "product_pre_conditioning_well_nourished")!;
    plan.items = [{ productName: "Invigour", quantityPerDay: 1 }, { productName: "Nourish", quantityPerDay: 3 }];
    plan.productNames = ["Invigour", "Nourish"];
    plan.dose = "1 Invigour + 3 Nourish";
  });
  const matchedFacts = { ...facts, assessmentDate: "2026-10-12", treatmentStatusId: "treatment_status_newly_diagnosed",
    plannedTreatmentStartDate: "2026-10-20" };
  const limited = await (await call("report-content", request({ facts: { ...matchedFacts, cancerTypeId: "cancer_5" } }))).json();
  expect(limited.guidance.carePlan.products).toMatchObject({ status: "selected", plans: [{ dose: "1 Invigour + 1 Nourish" }],
    notes: [{ action: { type: "limit", productName: "Nourish", maxQuantityPerDay: 1 } }] });
  expect(writerInputs.at(-1)).toContain("Limit Nourish to at most 1 per day.");
  expect(writerInputs.at(-1)).toContain("Nourish: 1 per day");
  const excluded = await (await call("report-content", request({ idempotencyKey: "report-run-2",
    facts: { ...matchedFacts, cancerTypeId: "cancer_6" } }))).json();
  expect(excluded.guidance.carePlan.products).toMatchObject({ status: "selected", plans: [{ products: "Invigour" }],
    notes: [{ action: { type: "remove", productName: "Nourish" } }] });
  expect(writerInputs.at(-1)).not.toContain("Remove Nourish from the product plan.");
  expect(writerInputs.at(-1)).toContain("Selected product plan: Invigour.");
});

test("an unresolved product plan withholds matched exception wording from the writer", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts, rule } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    definition.carePlanGuidance!.surgicalOverlapPolicy = "clinician_choice";
  });
  const matchedFacts = {
    ...facts, treatmentStatusId: "treatment_status_under_treatment",
    treatmentTypeIds: ["current_cancer_treatment_chemotherapy"],
    surgicalStatusId: "cancer_surgical_status_done", surgeryDate: "2026-01-01",
    dietPreferenceId: "vegetarian" as const,
  };
  const resolved = resolveCarePlanGuidance(rule.definition, {
    ...matchedFacts, riskCategoryId: "low", asOfDate: matchedFacts.assessmentDate,
  } as Parameters<typeof resolveCarePlanGuidance>[1]);
  expect(resolved.products.notes.length).toBeGreaterThan(0);
  const response = await call("report-content", request({ facts: matchedFacts }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.carePlan.products).toMatchObject({ status: "clinician_choice_required", plans: [], notes: [] });
  expect(writerInputs.at(-1)).not.toContain("rule:exception:");
  expect(writerInputs.at(-1)).not.toContain("Selected product plan:");
});

test("all treatment and class candidates reach the agent while reported effects remain separate", async () => {
  const writerInputs: string[] = [];
  const safetyInstructions: string[] = [];
  const { call, request, facts } = await setup((step, _call, user, system) => {
    if (step === "writer") { writerInputs.push(user); safetyInstructions.push(system); }
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_002")!.match = undefined;
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_006")!.match = { mode: "assessment_answer", anyOf: [{ fieldId: "dietary_symptoms", optionId: "dietary_symptoms_diarrhoea" }] };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_009")!.match = { mode: "assessment_answer", anyOf: [
      { fieldId: "dietary_symptoms", optionId: "dietary_symptoms_fatigue" },
      { fieldId: "appetite_status", optionId: "appetite_status_reduced" },
    ], operator: "any" };
  });
  const selected = { ...facts, drugClassIds: ["taxanes"], treatmentTypeIds: ["current_cancer_treatment_chemotherapy"] };
  const none = await (await call("report-content", request({ facts: selected }))).json();
  const candidateIds = none.guidance.possibleToxicities.map((item: { id: string }) => item.id);
  expect(candidateIds).toContain("toxicity_row_002");
  expect(candidateIds).toContain("toxicity_row_006");
  expect(candidateIds).toContain("toxicity_row_009");
  expect(none.guidance.possibleToxicities.every((item: { requiresDrugConfirmation: boolean }) => !item.requiresDrugConfirmation)).toBe(true);
  expect(none.guidance.possibleToxicities[0]).toHaveProperty("expectedToxicity");
  expect(none.guidance.toxicityInterventions).toEqual([]);
  expect(writerInputs[0]).toContain("possible:toxicity:toxicity_row_002");
  for (const id of candidateIds) expect(writerInputs[0]).toContain(`possible:toxicity:${id}`);
  expect(writerInputs[0]).not.toContain("Patient reported Diarrhoea");
  const matched = await (await call("report-content", request({ idempotencyKey: "report-run-2", facts: { ...selected,
    assessmentAnswers: { dietary_symptoms: ["dietary_symptoms_diarrhoea", "dietary_symptoms_fatigue"] } } }))).json();
  expect(matched.guidance.possibleToxicities.map((item: { id: string }) => item.id)).toEqual(candidateIds);
  expect(matched.guidance.toxicityInterventions).toEqual([]);
  expect(JSON.stringify(matched.guidance)).not.toContain("docetaxel");
  expect(writerInputs.at(-1)).toContain("Fatigue. This does not establish a treatment cause.");
  expect(writerInputs.at(-1)).not.toContain("Reduced. This does not establish a treatment cause.");
  expect(writerInputs.at(-1)).not.toContain("Nutrition guidance source topic: Fatigue / reduced appetite");
  expect(safetyInstructions.at(-1)).toContain("Keep possible effects conditional");
});

test("class candidate coverage stays conditional and named-drug candidates are rejected", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: Low Risk; reviewed score 12" },
    { id: "possible:toxicity:general", text: "Candidate guidance for the selected treatment and drug class. This is not evidence that the patient has an effect. Choose soft foods if mouth discomfort occurs." },
    { id: "possible:toxicity:second", text: "Conditional class-and-treatment candidate: taste changes. This is a possible effect, not a patient symptom or treatment causation." },
    { id: "possible:toxicity:drug", text: "Candidate guidance for the selected treatment and drug class. This is not evidence that the patient has an effect. Named-drug confirmation is required before applying this drug-specific advice. Avoid grapefruit during treatment." },
  ];
  expect(validateNarrative(noGuidanceNarrative, evidence).issues).toEqual([]);
  const conditional = { ...noGuidanceNarrative, treatmentAdvice: {
    text: "Possible mouth discomfort may occur. If it does, choose soft foods.", evidenceIds: ["possible:toxicity:general"],
  } };
  expect(validateNarrative(conditional, evidence).issues).toContain("treatmentAdvice:MISSING_MATCHED_GUIDANCE");
  const covered = { ...conditional, treatmentAdvice: {
    text: "Possible mouth discomfort and taste changes may occur.", evidenceIds: ["possible:toxicity:general", "possible:toxicity:second"],
  } };
  expect(validateNarrative(covered, evidence).issues).toContain("treatmentAdvice:MISSING_MATCHED_GUIDANCE");
  const drugSpecific = { ...noGuidanceNarrative, treatmentAdvice: {
    text: "Avoid grapefruit during treatment.", evidenceIds: ["possible:toxicity:drug"],
  } };
  expect(validateNarrative(drugSpecific, evidence).issues).toContain("treatmentAdvice:DRUG_SPECIFIC_CANDIDATE_UNVERIFIED");
});

test("future planned treatment is distinguished from treatment already underway", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: Low Risk; reviewed score 12" },
    { id: "fact:planned_treatment_start", text: "Treatment is planned to start on 20 Oct 2026. This date is after the assessment date 12 Oct 2026, so treatment is not confirmed as already underway." },
  ];
  const narrative = { ...safeNarrative, overview: {
    text: "The patient is receiving chemotherapy.", evidenceIds: ["fact:planned_treatment_start"],
  } };
  expect(validateNarrative(narrative, evidence).issues).toContain("overview:PLANNED_TREATMENT_AS_CURRENT");
  const planned = { ...narrative, overview: {
    text: "Treatment is planned to start on 20 Oct 2026.", evidenceIds: ["fact:planned_treatment_start"],
  } };
  expect(validateNarrative(planned, evidence).issues).not.toContain("overview:PLANNED_TREATMENT_AS_CURRENT");
});

test("clinician options are filtered to the pinned treatment and class and require a completed result", async () => {
  const { app, call, request, rule, getCalls } = await setup(undefined, definition => {
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_006")!.match = { mode: "clinician_confirmation" };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_007")!.match = { mode: "clinician_confirmation" };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_004")!.match = { mode: "clinician_confirmation" };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_004")!.enabled = false;
  });
  const selected = { assessmentReference: "report-assessment", resultReference: request().resultReference,
    treatmentTypeIds: ["current_cancer_treatment_chemotherapy"], drugClassIds: ["taxanes"] };
  const response = await call("report-toxicity-options", selected);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ assessmentReference: selected.assessmentReference, resultReference: selected.resultReference,
    ruleVersionId: rule.id, checksum: rule.packageChecksum });
  expect(body.options.map((item: { id: string }) => item.id)).toEqual([
    "toxicity_row_002", "toxicity_row_006", "toxicity_row_007", "toxicity_row_008", "toxicity_row_010",
  ]);
  expect(body.options[1]).toMatchObject({ id: "toxicity_row_006", classId: "taxanes", classLabel: "Taxanes",
    treatmentTypeId: "current_cancer_treatment_chemotherapy", treatmentTypeLabel: "Chemotherapy (Cytotoxic)", expectedToxicity: "Diarrhea" });
  expect(JSON.stringify(body)).not.toContain("docetaxel");
  expect((await call("report-toxicity-options", { ...selected, drugClassIds: ["other"] })).status).toBe(200);
  expect((await (await call("report-toxicity-options", { ...selected, drugClassIds: ["other"] })).json()).options).toEqual([]);
  expect((await call("report-toxicity-options", { ...selected, resultReference: "wrong" })).status).toBe(404);
  expect((await call("report-toxicity-options", { ...selected, drugClassIds: ["unknown"] })).status).toBe(400);
  expect((await call("report-toxicity-options", { ...selected, treatmentTypeIds: ["unknown"] })).status).toBe(400);
  expect((await call("report-toxicity-options", { ...selected, drugClassIds: ["other", "taxanes"] })).status).toBe(400);
  expect((await app.request("/v1/assessments/report-toxicity-options", { method: "POST", body: JSON.stringify(selected) })).status).toBe(401);
  expect(getCalls()).toBe(0);
});

test("explicit clinician confirmations remain separate facts and never select mandatory guidance", async () => {
  const prompts: string[] = [];
  const { call, request, facts, getCalls } = await setup((step, _call, user) => {
    if (step === "writer") prompts.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_006")!.match = { mode: "assessment_answer", anyOf: [{ fieldId: "dietary_symptoms", optionId: "dietary_symptoms_diarrhoea" }] };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_007")!.match = { mode: "clinician_confirmation" };
  });
  const selected = { ...facts, drugClassIds: ["taxanes"], treatmentTypeIds: ["current_cancer_treatment_chemotherapy"] };
  expect((await call("report-content", request({ facts: { ...selected, confirmedToxicityIds: ["toxicity_row_006"] } }))).status).toBe(400);
  expect((await call("report-content", request({ facts: { ...selected, confirmedToxicityIds: ["toxicity_row_999"] } }))).status).toBe(400);
  expect(getCalls()).toBe(0);
  const response = await call("report-content", request({ facts: { ...selected,
    confirmedToxicityIds: ["toxicity_row_007", "toxicity_row_007"], assessmentAnswers: { dietary_symptoms: ["dietary_symptoms_diarrhoea"] } } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.toxicityInterventions).toEqual([]);
  expect(prompts.at(-1)).toContain("fact:clinician_toxicity_toxicity_row_007");
  expect(prompts.at(-1)?.match(/fact:clinician_toxicity_toxicity_row_007/g)).toHaveLength(1);
  expect(body.guidance.possibleToxicities.some((item: { id: string }) => item.id === "toxicity_row_006")).toBe(true);
});

test("pinned answer options are validated and weight direction stays separate from candidate guidance", async () => {
  const prompts: string[] = [];
  const { call, request, facts, getCalls } = await setup((step, _call, user) => {
    if (step === "writer") prompts.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_107")!.match = { mode: "weight_change", direction: "gain" };
  });
  const selected = { ...facts, drugClassIds: ["anti_estrogens_serms"], treatmentTypeIds: ["current_cancer_treatment_hormonal"] };
  for (const assessmentAnswers of [
    { dietary_symptoms: ["not_an_option"] },
    { appetite_status: "not_an_option" },
    { previous_weight_kg: 0, current_weight_kg: 70 },
    { previous_weight_kg: 70, current_weight_kg: 1001 },
  ]) expect((await call("report-content", request({ facts: { ...selected, assessmentAnswers } }))).status).toBe(400);
  expect(getCalls()).toBe(0);
  const gain = await (await call("report-content", request({ facts: { ...selected,
    assessmentAnswers: { previous_weight_kg: 68, current_weight_kg: 70 } } }))).json();
  expect(gain.guidance.toxicityInterventions).toEqual([]);
  expect(gain.guidance.possibleToxicities.some((item: { id: string }) => item.id === "toxicity_row_107")).toBe(true);
  expect(prompts.at(-1)).toContain("Recorded weight gain: 68 kg previously and 70 kg currently");
  const unchanged = await (await call("report-content", request({ idempotencyKey: "unchanged-weight", facts: { ...selected,
    assessmentAnswers: { previous_weight_kg: 70, current_weight_kg: 70 } } }))).json();
  expect(unchanged.guidance.toxicityInterventions).toEqual([]);
});

test("unsupported numerals in optional overview are omitted without rewriting required care", async () => {
  const bad = { ...safeNarrative, overview: { text: "The score is 999.", evidenceIds: ["fact:niq_risk"] } };
  const { call, request, runs, getCalls } = await setup(step => step === "writer" ? bad : step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.narrative.overview.text).not.toContain("999");
  expect(body.omittedNarrativeFields).toContain("overview");
  expect(plainPart(body.narrative.nutritionAdvice)).toEqual(defaultNutritionPart);
  expect(getCalls()).toBe(2);
  expect((await runs.list({ page: 1, pageSize: 10 })).items[0]?.calls.map(call => call.step)).toContain("manager");
});

test("a second targeted revision can resolve a remaining validation issue", async () => {
  const first = { ...safeNarrative, nutritionAdvice: { text: "Take 999 servings.", evidenceIds: ["rule:nutrition:nutrition_low"] } };
  const second = { ...safeNarrative, nutritionAdvice: { text: "Take 888 servings.", evidenceIds: ["rule:nutrition:nutrition_low"] } };
  let revisions = 0;
  const { call, request, getCalls } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] }
    : step === "writer" ? first : ++revisions === 1 ? second.nutritionAdvice : defaultNutritionPart);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(plainPart(body.narrative.nutritionAdvice)).toEqual(defaultNutritionPart);
  expect(revisions).toBe(2);
  expect(getCalls()).toBe(6);
});

test("advice can cover several matched rules within its larger word budget", () => {
  const evidence = [
    { id: "rule:nutrition:a", text: "Nutrition support should be tailored to appetite and treatment tolerance." },
    { id: "rule:nutrition:b", text: "Monitor weekly intake and adjust the care plan with the treating team." },
  ];
  const narrative = { ...safeNarrative, nutritionAdvice: {
    text: Array(100).fill("nutrition").join(" "), evidenceIds: ["rule:nutrition:a", "rule:nutrition:b"],
  } };
  expect(validateNarrative(narrative, evidence).issues).not.toContain("nutritionAdvice:FIELD_TOO_LONG");
});

test("word counts guide writing without rejecting a supported longer passage", () => {
  const text = Array(190).fill("condition").join(" ");
  expect(text.length).toBeGreaterThan(1200);
  const issues = validateNarrative({ ...safeNarrative, conditionAdvice: {
    text, evidenceIds: ["rule:comorbidity:a"],
  } }, [{ id: "rule:comorbidity:a", text: "Discuss condition guidance with the care team." }]).issues;
  expect(issues).not.toContain("conditionAdvice:FIELD_TOO_LONG");
  expect(issues).not.toContain("INVALID_NARRATIVE_SCHEMA");
});

test("treatment guidance can cover several matched rules without clipping its advice", () => {
  const evidence = [{ id: "rule:treatment:a", text: "Discuss treatment nutrition with the care team." }];
  const narrative = { ...safeNarrative, treatmentAdvice: {
    text: Array(145).fill("care").join(" "), evidenceIds: ["rule:treatment:a"],
  } };
  expect(validateNarrative(narrative, evidence).issues).not.toContain("treatmentAdvice:FIELD_TOO_LONG");
  expect(validateNarrative({ ...narrative, treatmentAdvice: {
    ...narrative.treatmentAdvice, text: Array(161).fill("care").join(" "),
  } }, evidence).issues).not.toContain("treatmentAdvice:FIELD_TOO_LONG");
});

test("renal guidance blocks fixed nutrition and fluid instructions", () => {
  const evidence = [
    { id: "rule:nutrition:a", text: "Energy 25–30 kcal/kg/day and protein 1.2–1.5 g/kg/day." },
    { id: "rule:comorbidity:kidney", text: "Kidney disease: individualise nutrition targets and fluid needs with the care team." },
  ];
  const base = { ...safeNarrative,
    conditionAdvice: { text: "Discuss kidney targets with the care team.", evidenceIds: ["rule:comorbidity:kidney"] },
  };
  const fixed = { ...base, nutritionAdvice: { text: "Aim for 25–30 kcal/kg/day. Keep fluids up with water.", evidenceIds: ["rule:nutrition:a"] } };
  expect(validateNarrative(fixed, evidence).issues).toContain("nutritionAdvice:RENAL_TARGET_NEEDS_QUALIFICATION");
  const misleading = { ...base, nutritionAdvice: { text: "Aim for 25–30 kcal/kg/day and 1.2–1.5 g protein/kg/day, with your care team setting individual targets.", evidenceIds: ["rule:nutrition:a", "rule:comorbidity:kidney"] } };
  expect(validateNarrative(misleading, evidence).issues).toContain("nutritionAdvice:RENAL_TARGET_NEEDS_QUALIFICATION");
  const generalRange = { ...base, nutritionAdvice: { text: "The guidance lists 25–30 kcal/kg/day as a general range. Ask your care team to individualise your energy and fluid targets.", evidenceIds: ["rule:nutrition:a", "rule:comorbidity:kidney"] } };
  expect(validateNarrative(generalRange, evidence).issues).toContain("nutritionAdvice:RENAL_FIXED_TARGET_NEEDS_TEAM");
  const qualified = { ...base, nutritionAdvice: { text: "Ask your care team to individualise your energy, protein, and fluid targets.", evidenceIds: ["rule:nutrition:a", "rule:comorbidity:kidney"] } };
  expect(validateNarrative(qualified, evidence).issues).not.toContain("nutritionAdvice:RENAL_TARGET_NEEDS_QUALIFICATION");
  const withStatus = [...evidence, { id: "rule:status:a", text: "Potassium-rich foods may be relevant, depending on the patient's kidney plan." }];
  const directFoods = { ...qualified, treatmentAdvice: {
    text: "Include potassium-rich foods such as banana, as appropriate to your plan.", evidenceIds: ["rule:status:a"],
  } };
  expect(validateNarrative(directFoods, withStatus).issues).toContain("treatmentAdvice:RENAL_ELECTROLYTE_FOODS_NEED_APPROVAL");
  const checkedFoods = { ...qualified, treatmentAdvice: {
    text: "Ask your care team whether potassium-rich foods fit your individual plan.", evidenceIds: ["rule:status:a"],
  } };
  expect(validateNarrative(checkedFoods, withStatus).issues).not.toContain("treatmentAdvice:RENAL_ELECTROLYTE_FOODS_NEED_APPROVAL");
  const directBanana = { ...qualified, effectsAdvice: {
    text: "For nausea, try small bland meals such as toast or banana.", evidenceIds: ["rule:toxicity:nausea"],
  } };
  const withToxicity = [...evidence, { id: "rule:toxicity:nausea", text: "For nausea, small bland meals such as toast or banana and ORS sips if vomiting." }];
  expect(validateNarrative(directBanana, withToxicity).issues).toContain("effectsAdvice:RENAL_FOOD_EXAMPLE_NEEDS_APPROVAL");
  const teamApprovedBanana = { ...qualified, effectsAdvice: {
    text: "Ask your care team whether banana fits your kidney plan before including it.", evidenceIds: ["rule:toxicity:nausea", "rule:comorbidity:kidney"],
  } };
  expect(validateNarrative(teamApprovedBanana, withToxicity).issues).not.toContain("effectsAdvice:RENAL_FOOD_EXAMPLE_NEEDS_APPROVAL");
  const directOrs = { ...qualified, effectsAdvice: {
    text: "If vomiting occurs, take small sips of ORS.", evidenceIds: ["rule:toxicity:nausea"],
  } };
  expect(validateNarrative(directOrs, withToxicity).issues).toContain("effectsAdvice:RENAL_FLUID_ADVICE_NEEDS_APPROVAL");
  const teamApprovedOrs = { ...qualified, effectsAdvice: {
    text: "If your care team recommends ORS, take small sips as directed.", evidenceIds: ["rule:toxicity:nausea"],
  } };
  expect(validateNarrative(teamApprovedOrs, withToxicity).issues).not.toContain("effectsAdvice:RENAL_FLUID_ADVICE_NEEDS_APPROVAL");
});

test("oral intake targets refer to nutrition needs rather than previous intake", () => {
  const evidence = [{ id: "rule:nutrition:a", text: "Maintain oral intake at least 75% of requirements." }];
  const usual = { ...safeNarrative, nutritionAdvice: { text: "Try to eat at least 75% of your usual oral intake.", evidenceIds: ["rule:nutrition:a"] } };
  const needs = { ...safeNarrative, nutritionAdvice: { text: "Try to meet at least 75% of your nutrition needs by mouth.", evidenceIds: ["rule:nutrition:a"] } };
  expect(validateNarrative(usual, evidence).issues).toContain("nutritionAdvice:INTAKE_DENOMINATOR_UNCLEAR");
  expect(validateNarrative(needs, evidence).issues).not.toContain("nutritionAdvice:INTAKE_DENOMINATOR_UNCLEAR");
});

test("the higher sodium allowance does not inherit the lower allowance's salt equivalence", () => {
  const evidence = [{ id: "rule:comorbidity:hypertension", text: "Under 2 g sodium is about 5 g salt. For malnourished patients, use under 2.3 g sodium daily." }];
  const conflated = { ...safeNarrative, conditionAdvice: {
    text: "Keep sodium below 2.3 g daily, about 5 g of salt.", evidenceIds: ["rule:comorbidity:hypertension"],
  } };
  const accurate = { ...safeNarrative, conditionAdvice: {
    text: "Keep sodium below 2.3 g daily without reducing food intake.", evidenceIds: ["rule:comorbidity:hypertension"],
  } };
  expect(validateNarrative(conflated, evidence).issues).toContain("conditionAdvice:SODIUM_SALT_EQUIVALENCE_MISMATCH");
  expect(validateNarrative(accurate, evidence).issues).not.toContain("conditionAdvice:SODIUM_SALT_EQUIVALENCE_MISMATCH");
});

test("missing details leave unsupported passages empty without an unavailable-data placeholder", async () => {
  const omitted = { text: "", evidenceIds: [] };
  const draft = { ...safeNarrative, overview: safePart, keyFindings: omitted, actionSummary: omitted, monitoringSummary: omitted };
  const prompts: string[] = [];
  const { call, request, getCalls } = await setup((step, _call, user) => {
    prompts.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : draft;
  });
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(plainNarrative(body.narrative)).toEqual(draft);
  expect(body.omittedNarrativeFields).toEqual([]);
  expect(prompts[0]).toContain("Write the eleven schema fields");
  expect(prompts[0]).not.toContain("No product plan is selected");
  expect(getCalls()).toBe(2);
});

test("reviewed score must equal the completed result even with a fresh idempotency key", async () => {
  const { call, request, facts, runs } = await setup();
  const response = await call("report-content", request({ idempotencyKey: "new-report-key", facts: { ...facts, reviewedScore: 13 } }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "REVIEWED_SCORE_MISMATCH" });
  expect((await runs.list({ page: 1, pageSize: 10 })).items).toEqual([]);
});

test("a flagged optional passage receives scoped recovery without replacing approved care", async () => {
  let reviewed = 0;
  const { call, request, getCalls } = await setup(step => {
    if (step === "reviewer") return ++reviewed === 1
      ? { accepted: true, issues: [{ field: "overview", code: "UNCLEAR_WORDING", evidenceIds: ["fact:niq_risk"] }] }
      : { accepted: true, issues: [] };
    return safeNarrative;
  });
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.generationMode).toBe("SECTION_FALLBACK");
  expect(body.sectionOrigins.overview).toBe("rule_fallback");
  expect(body.sectionOrigins.nutritionAdvice).toBe("agent");
  expect(body.narrative.overview.text).toBe("");
  expect(getCalls()).toBe(3);
});

test("a rejected reviewer claim is never published", async () => {
  let reviewed = 0;
  const { call, request } = await setup(step => {
    if (step === "reviewer") return ++reviewed === 1
      ? { accepted: false, issues: [{ field: "overview", code: "UNSUPPORTED_CLAIM", evidenceIds: ["fact:niq_risk"],
        reason: "The draft claims a diagnosis that the score does not establish." }] }
      : { accepted: true, issues: [] };
    return safeNarrative;
  });
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.narrative.overview.text).not.toContain("diagnosis");
});

test("a repeatedly rejected passage remains held after scoped recovery is independently rejected", async () => {
  const { call, request, getCalls, verifiedFixture } = await setup(step => step === "reviewer"
    ? { accepted: true, issues: [{ field: "overview", code: "UNSUPPORTED_CLAIM", evidenceIds: ["fact:niq_risk"] }] }
    : safeNarrative);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("REVIEW_REQUIRED");
  expect(body.generationMode).toBe("SECTION_FALLBACK");
  expect(body.issues).toContain("overview:UNSUPPORTED_CLAIM");
  expect(body.sectionOrigins.nutritionAdvice).toBe("agent");
  expect(plainPart(body.narrative.nutritionAdvice)).toEqual(plainPart(verifiedFixture.nutritionAdvice));
  expect(getCalls()).toBe(3);
});

test("a still-unsupported optional action number is omitted while the report remains usable", async () => {
  const bad = { ...safeNarrative, actionSummary: { text: "Take 999 servings.", evidenceIds: ["fact:niq_risk"] } };
  const { call, request, getCalls } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] } : bad);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.omittedNarrativeFields).toContain("actionSummary");
  expect(body.narrative.actionSummary).toEqual({ text: "", evidenceIds: [] });
  expect(JSON.stringify(body.narrative)).not.toContain("999");
  // Three bounded no-change repair attempts precede the permitted omission.
  expect(getCalls()).toBe(5);
});

test("model punctuation and emoji are cleaned before independent clinical review", async () => {
  const styled = { ...safeNarrative, overview: { text: "Review risk; monitor intake — today 🩺", evidenceIds: ["fact:niq_risk"] } };
  const { call, request, getCalls } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] } : styled);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.omittedNarrativeFields).toEqual([]);
  expect(plainPart(body.narrative.overview)).toEqual({ text: "Review risk. Monitor intake, today", evidenceIds: ["fact:niq_risk"] });
  expect(getCalls()).toBe(2);
  expect(validateNarrative(normalizeNarrativePunctuation(styled), [{ id: "fact:niq_risk", text: "Review risk and monitor intake." }]).issues).not.toContain("overview:REPORT_STYLE");
});

test("caller supplied observation labels never enter model context", async () => {
  const prompts: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    prompts.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  const response = await call("report-content", request({ facts: {
    ...facts, observations: [{ id: "current_weight_kg", label: "Patient Name Secret", value: "68.4", unit: "secret unit" }],
  } }));
  expect(response.status).toBe(200);
  expect(prompts.join(" ")).not.toContain("Patient Name Secret");
  expect(prompts.join(" ")).not.toContain("secret unit");
  expect(prompts.join(" ")).toContain("Current weight: 68.4 kg");
});

test("provider payment failure uses the automatic verified rule fallback", async () => {
  const { call, request, runs } = await setup(() => { throw new ReportModelError("MODEL_PAYMENT_REQUIRED"); });
  const response = await call("report-content", request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "READY", generationMode: "RULE_FALLBACK" });
  expect((await runs.list({ page: 1, pageSize: 10 })).items[0]?.status).toBe("READY");
});

test("provider failure records the error privately and publishes only verified fallback content", async () => {
  const { call, request, runs } = await setup(() => { throw new ReportModelError("MODEL_UNAVAILABLE"); });
  const response = await call("report-content", request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "READY", generationMode: "RULE_FALLBACK" });
  const run = (await runs.list({ page: 1, pageSize: 10 })).items[0];
  expect(run?.status).toBe("READY");
  expect(run?.calls.some(call => call.status === "FAILED" && call.errorCode === "MODEL_UNAVAILABLE")).toBe(true);
});

test("emphasis markup cannot force valid near-limit report prose into fallback", async () => {
  let draft: ReturnType<typeof plainNarrative>;
  const topics = ["meals", "snacks", "food intake", "appetite", "fluid intake", "hydration", "diet", "nutrition", "protein intake", "energy intake"];
  // Distinct sentences keep this a length/formatting test rather than a
  // duplicate-prose fixture rejected by the editorial check.
  let text = "";
  for (const first of topics) for (const second of topics) {
    const sentence = `Monitor your ${first} and ${second} with your care team.`;
    if (text.length + sentence.length + 1 <= 3990) text += `${text ? " " : ""}${sentence}`;
  }
  const fixture = await setup(step => step === "reviewer" ? { accepted: true, issues: [] } : draft);
  draft = { ...plainNarrative(fixture.verifiedFixture), nutritionAdvice: { text, evidenceIds: fixture.verifiedFixture.nutritionAdvice.evidenceIds } };
  const response = await (await fixture.call("report-content", fixture.request())).json();
  expect(response.status).toBe("READY");
  expect(response.model).not.toBe("rule-fallback");
  expect(response.narrative.nutritionAdvice.text.length).toBeGreaterThan(4000);
  expect(response.narrative.nutritionAdvice.text.replaceAll("**", "")).toBe(text);
});


test("agent traces require an admin session and never enter deployment report or usage responses", async () => {
  const { app, call, request, traces, authStore, runs } = await setup();
  const body = await (await call("report-content", request())).json();
  const path = `/admin/report-ai/runs/${body.runId}/trace`;
  expect((await app.request(path)).status).toBe(401);
  expect((await app.request(path, { headers: { authorization: `Bearer niq_dep_report123456.${"a".repeat(40)}` } })).status).toBe(401);
  const userId = createEntityId();
  authStore.state.users.push({ id: userId, email: "trace@example.test", displayName: "Trace admin", passwordHash: "unused", enabled: true, createdAt: "2026-01-01T00:00:00Z" });
  const token = "test-admin-trace-session";
  authStore.state.sessions.push({ userId, tokenHash: new Bun.CryptoHasher("sha256").update(token).digest("hex"), expiresAt: "2099-01-01T00:00:00Z" });
  const response = await app.request(path, { headers: { cookie: `niq_scoring_session=${token}` } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const trace = await response.json();
  expect(trace.run.promptVersion).toContain("prompt100");
  expect(trace.calls.find((row: any) => row.step === "writer").user).toContain("Current weight");
  expect(trace.calls.find((row: any) => row.step === "reviewer").response).toEqual({ accepted: true, issues: [] });
  expect(trace.events.map((row: any) => row.stage)).toEqual(["run_started", "agent_review_complete", "run_complete"]);
  expect(JSON.stringify(await runs.list({ page: 1, pageSize: 10 }))).not.toContain("Current weight");
  expect(body).not.toHaveProperty("trace");
  expect((await traces.read(body.runId))?.calls).toHaveLength(trace.calls.length);
});

test("fallback preserves agent rejection messages and final reasons in the private trace", async () => {
  const reason = "The proposed nutrition instruction conflicts with its cited source.";
  const { call, request, traces } = await setup(step => step === "reviewer"
    ? { accepted: false, issues: [{ field: "nutritionAdvice", code: "UNCLEAR_WORDING", evidenceIds: ["rule:nutrition:nutrition_low"], reason }] }
    : safeNarrative);
  const body = await (await call("report-content", request())).json();
  expect(body.generationMode).toBe("SECTION_FALLBACK");
  expect(body.status).toBe("REVIEW_REQUIRED");
  expect(body.sectionOrigins.nutritionAdvice).toBe("rule_fallback");
  const trace = await traces.read(body.runId);
  expect(trace?.calls.some(row => row.step === "reviewer" && JSON.stringify(row.response).includes(reason))).toBe(true);
  const decision = trace?.events.find(row => row.stage === "agent_review_complete");
  expect(decision?.payload).toMatchObject({ status: "REVIEW_REQUIRED", issues: expect.arrayContaining(["nutritionAdvice:UNCLEAR_WORDING"]) });
  expect(trace?.events.at(-1)?.payload).toEqual({ status: "REVIEW_REQUIRED", generationMode: "SECTION_FALLBACK" });
  expect(JSON.stringify(body)).not.toContain(reason);
});


test("a timed-out source planner fails explicitly without publishing a rule fallback", async () => {
  const { call, request, runs } = await setup(undefined, undefined, undefined, undefined, undefined, undefined,
    () => { throw new ReportModelError("MODEL_TIMEOUT"); });
  const response = await call("report-content", request());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.error).toBe("MODEL_SOURCE_CHECKLIST_FAILED");
  const run = (await runs.list({ page: 1, pageSize: 10 })).items[0]!;
  expect(run.status).toBe("FAILED");
  expect(run.calls.some(call => call.step === "writer")).toBe(false);
});


test("a failed planning attempt exposes worker-owned retry progress and resubmission keeps one job", async () => {
  let now = Date.now();
  const jobs = new MemoryReportContentJobStore(() => new Date(now));
  const f = await setup(undefined, undefined, undefined, undefined, undefined, undefined, () => ({assignments: []}), jobs);
  const submitted = await (await f.call("report-content/jobs", f.request())).json();
  await f.jobTick();
  const poll = await (await f.app.request(`/v1/assessments/report-content/jobs/${submitted.runId}`, {
    headers: {authorization: `Bearer ${f.token}`},
  })).json();
  expect(poll.status).toBe("QUEUED");
  expect(poll.errorCode).toBe("MODEL_INVALID_SOURCE_CHECKLIST");
  expect(poll.attempts).toBe(1);
  expect(poll.retryScheduled).toBe(true);
  expect(Date.parse(poll.nextAttemptAt)).toBeGreaterThan(Date.now());
  const again = await (await f.call("report-content/jobs", f.request())).json();
  expect(again.runId).toBe(submitted.runId);
  expect(f.jobs.jobs).toHaveLength(1);
  const claim = f.jobs.jobs[0]!;
  expect(claim.status).toBe("QUEUED");
  expect(claim.attempts).toBe(1);
  for (let retry = 0; retry < 2; retry++) { now += 90_000; await f.jobTick(); }
  const terminal = await (await f.app.request(`/v1/assessments/report-content/jobs/${submitted.runId}`, {
    headers: {authorization: `Bearer ${f.token}`},
  })).json();
  expect(terminal).toMatchObject({status: "FAILED", attempts: 3, retryScheduled: false, nextAttemptAt: null});
  expect(f.jobs.jobs).toHaveLength(1);
});

test("narrative sentence capitalization is normalized before review without changing units", () => {
  const input = {...safeNarrative, monitoringSummary: {text: "Monitor intake. your care team should adjust support if needed. Keep pH, 1.2 g/kg/day and e.g. your usual foods unchanged.", evidenceIds: ["fact:niq_risk"]}};
  const normalized = normalizeNarrativePunctuation(input) as typeof input;
  expect(normalized.monitoringSummary.text).toBe("Monitor intake. Your care team should adjust support if needed. Keep pH, 1.2 g/kg/day and e.g. your usual foods unchanged.");
  expect(input.monitoringSummary.text).toContain(". your care team");
});
