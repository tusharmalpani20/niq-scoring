import { expect, test } from "bun:test";
import { OpenRouterReportClient } from "./openrouter-report-client";

test("OpenRouter report calls pin Luna and a single zero-retention provider", async () => {
  let seen: Record<string, unknown> | null = null;
  const request = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    seen = JSON.parse(String(init?.body));
    return Response.json({ id: "gen-1", provider: "azure", choices: [{ message: { content: JSON.stringify({ accepted: true, issues: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.001 } });
  }) as typeof fetch;
  const client = new OpenRouterReportClient("test-secret", "https://openrouter.ai/api/v1", request);
  const response = await client.complete({ step: "reviewer", system: "fixed safety", user: "review data", schema: { type: "object" } });
  expect(response.content).toEqual({ accepted: true, issues: [] });
  expect(response.usage).toMatchObject({ generationId: "gen-1", provider: "azure", promptTokens: 10, completionTokens: 4, costUsd: 0.001 });
  expect(seen).toMatchObject({ model: "openai/gpt-6-luna", provider: { only: ["azure"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true }, messages: [{ role: "system", content: "fixed safety" }, { role: "user", content: "review data" }] });
  expect(JSON.stringify(seen)).not.toContain("test-secret");
});

test("an explicitly non-Azure provider response fails closed", async () => {
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json({
    id: "gen-2", provider: "openai", choices: [{ message: { content: "{}" } }],
  })) as typeof fetch;
  const client = new OpenRouterReportClient("test-secret", "https://openrouter.ai/api/v1", request);
  await expect(client.complete({ step: "writer", system: "fixed safety", user: "data", schema: { type: "object" } }))
    .rejects.toMatchObject({ code: "MODEL_PROVIDER_MISMATCH" });
});

test("a transient empty model response is retried without accepting missing content", async () => {
  let attempts = 0;
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => {
    attempts++;
    return Response.json({ id: `gen-${attempts}`, provider: "azure", choices: [{ message: {
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
