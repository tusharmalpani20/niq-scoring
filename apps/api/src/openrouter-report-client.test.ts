import { expect, test } from "bun:test";
import { OpenRouterReportClient, type ProviderAttempt } from "./openrouter-report-client";
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

test("truncated reviewer output retries with more room and records each billed attempt", async () => {
  const bodies: any[] = [], attempts: ProviderAttempt[] = [];
  const request = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const truncated = bodies.length === 1;
    return Response.json({ id: `gen-${bodies.length}`, provider: "Azure",
      choices: [{ finish_reason: truncated ? "length" : "stop", message: {
        // Even valid JSON must not be accepted when the provider says it was cut off.
        content: JSON.stringify({ accepted: true, issues: [] }),
      } }], usage: { prompt_tokens: 24051, completion_tokens: truncated ? 6000 : 2000,
        completion_tokens_details: { reasoning_tokens: truncated ? 5900 : 1000 }, cost: 0.02 } });
  }) as typeof fetch;
  const result = await new OpenRouterReportClient("secret", undefined, request).complete({
    step: "reviewer", system: "policy", user: "draft", schema: { type: "object" },
    onAttempt: async attempt => { attempts.push(attempt); },
  });
  expect(bodies.map(body => body.max_tokens)).toEqual([6000, 12000]);
  expect(result.content).toEqual({ accepted: true, issues: [] });
  expect(attempts).toMatchObject([
    { attempt: 1, maxTokens: 6000, finishReason: "length", errorCode: "MODEL_OUTPUT_LIMIT", usage: { generationId: "gen-1", costUsd: 0.02 } },
    { attempt: 2, maxTokens: 12000, finishReason: "stop", errorCode: null, usage: { generationId: "gen-2", costUsd: 0.02 } },
  ]);
});

test("exhausted output retries fail closed at a bounded cap and retain failure usage", async () => {
  const caps: number[] = [], attempts: ProviderAttempt[] = [];
  const request = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    caps.push(JSON.parse(String(init?.body)).max_tokens);
    return Response.json({ id: `gen-${caps.length}`, provider: "Azure",
      choices: [{ finish_reason: "length", message: { content: '{"accepted":' } }],
      usage: { prompt_tokens: 100, completion_tokens: caps.at(-1), cost: 0.03 } });
  }) as typeof fetch;
  await expect(new OpenRouterReportClient("secret", undefined, request).complete({
    step: "reviewer", system: "policy", user: "draft", schema: {},
    onAttempt: async attempt => { attempts.push(attempt); },
  })).rejects.toMatchObject({ code: "MODEL_OUTPUT_LIMIT", usage: { generationId: "gen-3", costUsd: 0.03 } });
  expect(caps).toEqual([6000, 12000, 24000]);
  expect(attempts).toHaveLength(3);
});

test("refusals are not retried or mistaken for JSON failures", async () => {
  let count = 0;
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => {
    count++;
    return Response.json({ provider: "Azure", choices: [{ finish_reason: "stop", message: {
      content: null, refusal: "private provider text",
    } }], usage: { cost: 0.01 } });
  }) as typeof fetch;
  await expect(new OpenRouterReportClient("secret", undefined, request).complete({
    step: "reviewer", system: "policy", user: "draft", schema: {},
  })).rejects.toMatchObject({ code: "MODEL_REFUSAL", usage: { costUsd: 0.01 } });
  expect(count).toBe(1);
});

test("a failure to persist attempt metadata stops retries before another model call", async () => {
  let count = 0;
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => {
    count++;
    return Response.json({ provider: "Azure", choices: [{ finish_reason: "length", message: { content: "" } }] });
  }) as typeof fetch;
  await expect(new OpenRouterReportClient("secret", undefined, request).complete({
    step: "reviewer", system: "policy", user: "draft", schema: {},
    onAttempt: async () => { throw new Error("trace unavailable"); },
  })).rejects.toThrow("trace unavailable");
  expect(count).toBe(1);
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

test("all agent stages grow only output-limit retries within their own ceiling", async () => {
  const stages = [
    ["manager", [8000, 16000, 32000]], ["writer", [8000, 16000, 32000]],
    ["revision", [8000, 16000, 32000]], ["reviewer", [6000, 12000, 24000]],
    ["coverage", [8000, 16000, 32000]], ["summarizer", [8000, 16000, 32000]],
    ["highlighter", [4000, 8000, 16000]],
  ] as const;
  await Promise.all(stages.map(async ([step, expected]) => {
    const seen: number[] = [];
    const request = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)).max_tokens);
      return Response.json({ provider: "Azure", choices: [{ finish_reason: "length", message: { content: "" } }] });
    }) as typeof fetch;
    await expect(new OpenRouterReportClient("secret", undefined, request).complete({ step, system: "policy", user: "draft", schema: {} }))
      .rejects.toMatchObject({ code: "MODEL_OUTPUT_LIMIT" });
    expect(seen).toEqual([...expected]);
  }));
}, 10000);

test("reasoning fallback is recorded and stays within the same three-request budget", async () => {
  const bodies: any[] = [], attempts: ProviderAttempt[] = [];
  const request = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) return Response.json({ error: { message: "unsupported reasoning effort" } }, { status: 400 });
    return Response.json({ provider: "Azure", choices: [{ finish_reason: bodies.length === 2 ? "length" : "stop", message: { content: "{}" } }] });
  }) as typeof fetch;
  await new OpenRouterReportClient("secret", undefined, request).complete({ step: "reviewer", system: "policy", user: "draft", schema: {},
    onAttempt: async attempt => { attempts.push(attempt); } });
  expect(bodies.map(body => body.max_tokens)).toEqual([6000, 6000, 12000]);
  expect(bodies[0].reasoning).toEqual({ effort: "medium" });
  expect(bodies[1]).not.toHaveProperty("reasoning");
  expect(attempts.map(attempt => attempt.errorCode)).toEqual(["MODEL_REASONING_UNSUPPORTED", "MODEL_OUTPUT_LIMIT", null]);
});

test("invalid JSON retains billing without increasing the token allowance blindly", async () => {
  const bodies: any[] = [], attempts: ProviderAttempt[] = [];
  const request = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ id: `gen-${bodies.length}`, provider: "Azure", choices: [{ finish_reason: "stop", message: {
      content: bodies.length === 1 ? "private invalid text" : "{}",
    } }], usage: { cost: 0.01 } });
  }) as typeof fetch;
  await new OpenRouterReportClient("secret", undefined, request).complete({ step: "reviewer", system: "policy", user: "draft", schema: {},
    onAttempt: async attempt => { attempts.push(attempt); } });
  expect(bodies.map(body => body.max_tokens)).toEqual([6000, 6000]);
  expect(attempts[0]).toMatchObject({ errorCode: "MODEL_INVALID_JSON", usage: { generationId: "gen-1", costUsd: 0.01 } });
  expect(JSON.stringify(attempts)).not.toContain("private invalid text");
});

test.each([
  [402, "Payment required", "MODEL_PAYMENT_REQUIRED"],
  ["402", "Payment required", "MODEL_PAYMENT_REQUIRED"],
  ["401", "Invalid credential", "MODEL_HTTP_401"],
  [403, "Access denied", "MODEL_HTTP_403"],
  ["400", "Context length exceeded", "MODEL_CONTEXT_LIMIT"],
  [400, "Content policy rejection", "MODEL_CONTENT_FILTER"],
] as const)("HTTP 200 envelope with code %s retains its cause and stops unnecessary retries", async (code, message, expected) => {
  let requests = 0;
  const attempts: ProviderAttempt[] = [];
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => {
    requests++;
    return Response.json({ id: "failed-generation", provider: "Azure", error: { code, message }, usage: { cost: 0.01 } });
  }) as typeof fetch;
  await expect(new OpenRouterReportClient("secret", undefined, request).complete({
    step: "reviewer", system: "policy", user: "draft", schema: {},
    onAttempt: async outcome => { attempts.push(outcome); },
  })).rejects.toMatchObject({ code: expected, usage: { generationId: "failed-generation", costUsd: 0.01 } });
  expect(requests).toBe(1);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.errorCode).toBe(expected);
  expect(JSON.stringify(attempts)).not.toContain(message);
});

test("non-200 failures retain any returned billing before classifying the error", async () => {
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json({
    id: "gen-filtered", provider: "Azure", error: { code: 403, message: "Content policy rejection" },
    usage: { prompt_tokens: 50, completion_tokens: 2, cost: 0.01 },
  }, { status: 403 })) as typeof fetch;
  await expect(new OpenRouterReportClient("secret", undefined, request).complete({
    step: "reviewer", system: "policy", user: "draft", schema: {},
  })).rejects.toMatchObject({ code: "MODEL_CONTENT_FILTER", usage: {
    generationId: "gen-filtered", promptTokens: 50, completionTokens: 2, costUsd: 0.01,
  } });
});

test("a transient HTTP 200 rate-limit envelope retries without changing the output cap", async () => {
  const bodies: any[] = [], attempts: ProviderAttempt[] = [];
  const request = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(bodies.length === 1
      ? { id: "gen-limited", error: { code: "429", message: "Rate limited" } }
      : { id: "gen-success", provider: "Azure", choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
  }) as typeof fetch;
  await new OpenRouterReportClient("secret", undefined, request).complete({
    step: "reviewer", system: "policy", user: "draft", schema: {},
    onAttempt: async outcome => { attempts.push(outcome); },
  });
  expect(bodies.map(body => body.max_tokens)).toEqual([6000, 6000]);
  expect(attempts.map(attempt => attempt.errorCode)).toEqual(["MODEL_RATE_LIMITED", null]);
});

test("non-JSON HTTP authentication failures are not mistaken for transient invalid JSON", async () => {
  let requests = 0;
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit) => {
    requests++;
    return new Response("Private gateway message", { status: 401 });
  }) as typeof fetch;
  await expect(new OpenRouterReportClient("secret", undefined, request).complete({
    step: "reviewer", system: "policy", user: "draft", schema: {},
  })).rejects.toMatchObject({ code: "MODEL_HTTP_401" });
  expect(requests).toBe(1);
});

test("a timeout reading the response body retains its timeout cause", async () => {
  const attempts: ProviderAttempt[] = [];
  const request = (async (_url: URL | RequestInfo, _init?: RequestInit): Promise<Response> => Object.assign(new Response("unused"), {
    json: async () => { throw new DOMException("private transport detail", "TimeoutError"); },
  })) as typeof fetch;
  await expect(new OpenRouterReportClient("secret", undefined, request).complete({
    step: "reviewer", system: "policy", user: "draft", schema: {},
    onAttempt: async outcome => { attempts.push(outcome); },
  })).rejects.toMatchObject({ code: "MODEL_TIMEOUT" });
  expect(attempts.map(attempt => attempt.errorCode)).toEqual(["MODEL_TIMEOUT", "MODEL_TIMEOUT", "MODEL_TIMEOUT"]);
  expect(JSON.stringify(attempts)).not.toContain("private transport detail");
});
