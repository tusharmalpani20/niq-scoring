import { expect, test } from "bun:test";
import { OpenRouterReportClient } from "./openrouter-report-client";
import { CodexProxyReportClient } from "./codex-proxy-report-client";

test("OpenRouter manager and worker routes use the approved Azure models with medium reasoning", async () => {
  let seen: Record<string, unknown> | null = null;
  const request = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    seen = JSON.parse(String(init?.body));
    return Response.json({ id: "gen-1", provider: "Azure", choices: [{ message: { content: JSON.stringify({ accepted: true, issues: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0 } });
  }) as typeof fetch;
  const client = new OpenRouterReportClient("test-secret", "https://openrouter.ai/api/v1", request);
  const response = await client.complete({ step: "manager", system: "fixed safety", user: "review data", schema: { type: "object" } });
  expect(response.content).toEqual({ accepted: true, issues: [] });
  expect(response.usage).toMatchObject({ generationId: "gen-1", provider: "Azure", promptTokens: 10, completionTokens: 4, costUsd: 0 });
  expect(seen).toMatchObject({ model: "openai/gpt-6.1-sol", reasoning: { effort: "medium" },
    provider: { only: ["azure"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true },
    messages: [{ role: "system", content: "fixed safety" }, { role: "user", content: "review data" }] });
  const workerRequest = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    seen = JSON.parse(String(init?.body));
    return Response.json({ id: "gen-worker", provider: "Azure", choices: [{ message: { content: "{}" } }] });
  }) as typeof fetch;
  await new OpenRouterReportClient("test-secret", "https://openrouter.ai/api/v1", workerRequest)
    .complete({ step: "writer", system: "worker safety", user: "write data", schema: { type: "object" } });
  expect(seen).toMatchObject({ model: "openai/gpt-6-luna", reasoning: { effort: "medium" }, provider: { only: ["azure"] } });
  expect(JSON.stringify(seen)).not.toContain("test-secret");
});

test("a provider other than Azure fails closed", async () => {
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json({
    id: "gen-2", provider: "OpenAI", choices: [{ message: { content: "{}" } }],
  })) as typeof fetch;
  const client = new OpenRouterReportClient("test-secret", "https://openrouter.ai/api/v1", request);
  await expect(client.complete({ step: "writer", system: "fixed safety", user: "data", schema: { type: "object" } }))
    .rejects.toMatchObject({ code: "MODEL_PROVIDER_MISMATCH" });
});

test("a transient empty model response is retried without accepting missing content", async () => {
  let attempts = 0;
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => {
    attempts++;
    return Response.json({ id: `gen-${attempts}`, provider: "Azure", choices: [{ message: {
      content: attempts === 1 ? null : JSON.stringify({ accepted: true, issues: [] }),
    } }] });
  }) as typeof fetch;
  const client = new OpenRouterReportClient("test-secret", "https://openrouter.ai/api/v1", request);
  const response = await client.complete({ step: "reviewer", system: "fixed safety", user: "data", schema: { type: "object" } });
  expect(attempts).toBe(2);
  expect(response.content).toEqual({ accepted: true, issues: [] });
});


test("a provider spend limit stops generation with a fixed payment code", async () => {
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) =>
    Response.json({ error: { message: "Account has reached its spend limit" } }, { status: 402 })) as typeof fetch;
  const client = new OpenRouterReportClient("test-secret", "https://openrouter.ai/api/v1", request);
  await expect(client.complete({ step: "writer", system: "fixed safety", user: "data", schema: { type: "object" } }))
    .rejects.toMatchObject({ code: "MODEL_PAYMENT_REQUIRED" });
});


test("both provider adapters assign every report stage to the same model role", async () => {
  const bodies: Record<string, unknown>[] = [];
  const request = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return Response.json({id: "routing-test", provider: "Azure", model: body.model,
      choices: [{message: {content: "{}"}}]});
  }) as typeof fetch;
  const openRouter = new OpenRouterReportClient("test-secret", "https://openrouter.ai/api/v1", request);
  const proxy = new CodexProxyReportClient("http://127.0.0.1:8999", "test", "gpt-6.1-sol", "gpt-6-luna");
  const schema = {type: "object", additionalProperties: false, properties: {}};
  const stages = [
    ["manager", "gpt-6.1-sol"], ["reviewer", "gpt-6.1-sol"], ["coverage", "gpt-6.1-sol"],
    ["writer", "gpt-6-luna"], ["revision", "gpt-6-luna"],
    ["summarizer", "gpt-6-luna"], ["highlighter", "gpt-6-luna"],
  ] as const;
  for (const [step, model] of stages) {
    const expected = `openai/${model}`;
    const result = await openRouter.complete({step, system: "fixed policy", user: "clinical context", schema});
    expect(proxy.modelForStep(step)).toBe(model);
    expect(openRouter.modelForStep(step)).toBe(expected);
    expect(result.usage.model).toBe(expected);
    expect(bodies.at(-1)).toMatchObject({model: expected,
      messages: [{role: "system", content: "fixed policy"}, {role: "user", content: "clinical context"}],
      response_format: {json_schema: {schema}}});
  }
  expect(bodies).toHaveLength(stages.length);
});
