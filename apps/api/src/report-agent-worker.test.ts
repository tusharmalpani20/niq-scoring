import { expect, test } from "bun:test";
import { createReportAgentWorkers, ReportAttemptLost, ReportTraceError } from "./report-agent-worker";
import { MemoryReportGenerationStore } from "./report-generation-store";
import { OpenRouterReportClient } from "./openrouter-report-client";

const usage = { model: "worker", provider: "test", generationId: "generation", promptTokens: 2,
  completionTokens: 1, reasoningTokens: 0, costUsd: null, latencyMs: 1 };
async function fixture(provider: { complete: (input: any) => Promise<any> }, traceOverrides = {}) {
  const runStore = new MemoryReportGenerationStore();
  const reserved = await runStore.reserve({ clientId: "client", deploymentId: "deployment", assessmentReference: "assessment",
    resultReference: "result", ruleVersionId: "rule", checksum: "checksum", idempotencyKey: "key", fingerprint: "fingerprint",
    model: "worker", promptVersion: "prompt-version", schemaVersion: 4 });
  if (reserved.status !== "NEW") throw new Error("Expected new run");
  const requests: any[] = [], responses: any[] = [];
  const traceStore = {
    beginCall: async (_run: string, _attempt: string, input: any) => { requests.push(input); return `call-${input.sequence}`; },
    completeCall: async (_run: string, _attempt: string, id: string, input: any) => { responses.push({ id, ...input }); return true; },
    appendEvent: async () => true, read: async () => null, pruneExpired: async () => {}, ...traceOverrides,
  };
  const workers = createReportAgentWorkers({ provider, runStore, traceStore, runId: reserved.run.id, attemptId: reserved.run.attemptId });
  return { ...workers, requests, responses, runStore };
}

test("records the exact sent prompts before inference and retains outputs outside usage summaries", async () => {
  let captured: any;
  const f = await fixture({ complete: async input => {
    expect(f.requests).toHaveLength(1); captured = input;
    return { content: { accepted: false, issues: [{ field: "nutritionAdvice", reason: "Conflicting source targets" }] }, usage };
  } });
  try {
    const response = await f.invoke("reviewer", "System policy", "Clinical draft", { type: "object" });
    expect(f.requests[0]).toMatchObject({ sequence: 1, step: "reviewer", system: captured.system, user: captured.user, schema: captured.schema });
    expect(captured.system).toContain("Do not mention HbA1c");
    expect(f.responses[0]).toMatchObject({ id: "call-1", response, usage });
    const list = JSON.stringify(await f.runStore.list({ page: 1, pageSize: 10 }));
    expect(list).not.toContain("Clinical draft");
    expect(list).not.toContain("Conflicting source targets");
  } finally { f.stop(); }
});

test("call sequence follows dispatch order even when responses complete in reverse", async () => {
  let finishFirst!: () => void;
  const first = new Promise<void>(resolve => { finishFirst = resolve; });
  const f = await fixture({ complete: async ({ user }) => {
    if (user === "first") await first; else finishFirst();
    return { content: user, usage };
  } });
  try {
    await Promise.all([f.invoke("highlighter", "policy", "first", {}), f.invoke("highlighter", "policy", "second", {})]);
    expect(f.requests.map(row => [row.sequence, row.user])).toEqual([[1, "first"], [2, "second"]]);
    expect(f.responses.map(row => row.id)).toEqual(["call-2", "call-1"]);
  } finally { f.stop(); }
});

test("retains a safe failure code without storing arbitrary provider error messages", async () => {
  const f = await fixture({ complete: async () => { throw new Error("token=secret upstream response"); } });
  try {
    await expect(f.invoke("writer", "policy", "draft", {})).rejects.toThrow("token=secret");
    expect(f.responses[0]).toMatchObject({ errorCode: "MODEL_UNAVAILABLE" });
    expect(JSON.stringify(f.responses)).not.toContain("secret");
  } finally { f.stop(); }
});

test("does not call the provider when the request cannot be durably traced", async () => {
  let called = false;
  const f = await fixture({ complete: async () => { called = true; return { content: {}, usage }; } },
    { beginCall: async () => { throw new Error("database failure"); } });
  try {
    await expect(f.invoke("writer", "policy", "draft", {})).rejects.toBeInstanceOf(ReportTraceError);
    expect(called).toBe(false);
  } finally { f.stop(); }
});

test("a swallowed optional-formatting trace error still prevents untraced publication", async () => {
  const f = await fixture({ complete: async () => ({ content: { points: [] }, usage }) },
    { completeCall: async () => { throw new Error("database unavailable"); } });
  try {
    await f.invoke("highlighter", "policy", "draft", {}).catch(() => undefined);
    expect(() => f.assertActive()).toThrow(ReportTraceError);
  } finally { f.stop(); }
});

test("OpenRouter retries persist individual costs and stopping reasons without double counting the stage", async () => {
  let requests = 0;
  const events: any[] = [];
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => {
    requests++;
    return Response.json({ id: `gen-${requests}`, provider: "Azure",
      choices: [{ finish_reason: requests === 1 ? "length" : "stop", message: { content: '{"accepted":true,"issues":[]}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, cost: requests === 1 ? 0.02 : 0.03 } });
  }) as typeof fetch;
  const f = await fixture(new OpenRouterReportClient("secret", undefined, request), {
    appendEvent: async (_run: string, _attempt: string, event: any) => { events.push(event); return true; },
  });
  try {
    expect(await f.invoke("reviewer", "policy", "draft", {})).toEqual({ accepted: true, issues: [] });
    expect(f.requests).toHaveLength(1);
    expect(events.map(event => [event.stage, event.payload.sequence, event.payload.finishReason])).toEqual([
      ["provider_attempt", 1, "length"], ["provider_attempt", 1, "stop"],
    ]);
    expect(f.runStore.calls.map(row => [row.call.status, row.call.generationId, row.call.costUsd])).toEqual([
      ["FAILED", "gen-1", 0.02], ["SUCCEEDED", "gen-2", 0.03],
    ]);
    expect(f.responses[0].usage.providerAttempts).toHaveLength(2);
  } finally { f.stop(); }
});

test("failed OpenRouter attempts retain their costs and precise terminal error", async () => {
  let requests = 0;
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json({ id: `gen-${++requests}`, provider: "Azure",
    choices: [{ finish_reason: "length", message: { content: "" } }], usage: { cost: 0.02 } })) as typeof fetch;
  const f = await fixture(new OpenRouterReportClient("secret", undefined, request));
  try {
    await expect(f.invoke("reviewer", "policy", "draft", {})).rejects.toMatchObject({ code: "MODEL_OUTPUT_LIMIT" });
    expect(f.runStore.calls).toHaveLength(3);
    expect(f.runStore.calls.every(row => row.call.errorCode === "MODEL_OUTPUT_LIMIT" && row.call.costUsd === 0.02)).toBe(true);
    expect(f.responses[0]).toMatchObject({ errorCode: "MODEL_OUTPUT_LIMIT" });
    expect(f.responses[0].usage.providerAttempts).toHaveLength(3);
  } finally { f.stop(); }
});

test("attempt trace failures prevent further provider requests", async () => {
  let requests = 0;
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => { requests++; return Response.json({ provider: "Azure",
    choices: [{ finish_reason: "length", message: { content: "" } }] }); }) as typeof fetch;
  const f = await fixture(new OpenRouterReportClient("secret", undefined, request), { appendEvent: async () => false });
  try {
    await expect(f.invoke("reviewer", "policy", "draft", {})).rejects.toThrow();
    expect(requests).toBe(1);
  } finally { f.stop(); }
});

test("losing the run lease between attempts stops the next request before inference", async () => {
  let requests = 0, checks = 0;
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => {
    requests++;
    return Response.json({ id: "gen-first", provider: "Azure", choices: [{
      finish_reason: "length", message: { content: "" },
    }], usage: { cost: 0.01 } });
  }) as typeof fetch;
  const f = await fixture(new OpenRouterReportClient("secret", undefined, request));
  f.runStore.renew = async () => ++checks === 1;
  try {
    await expect(f.invoke("reviewer", "policy", "draft", {})).rejects.toBeInstanceOf(ReportAttemptLost);
    expect(requests).toBe(1);
    expect(f.runStore.calls).toHaveLength(1);
    expect(f.runStore.calls[0]?.call.costUsd).toBe(0.01);
    expect(() => f.assertActive()).toThrow(ReportAttemptLost);
  } finally { f.stop(); }
});

test("an initial lease-check failure prevents inference and remains fatal to optional formatting", async () => {
  let requests = 0;
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => { requests++; return Response.json({}); }) as typeof fetch;
  const f = await fixture(new OpenRouterReportClient("secret", undefined, request));
  f.runStore.renew = async () => { throw new Error("database unavailable"); };
  try {
    await expect(f.invoke("highlighter", "policy", "draft", {})).rejects.toBeInstanceOf(ReportTraceError);
    expect(requests).toBe(0);
    expect(() => f.assertActive()).toThrow(ReportTraceError);
  } finally { f.stop(); }
});
