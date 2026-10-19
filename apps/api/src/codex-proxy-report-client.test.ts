import { expect, test } from "bun:test";
import { CodexProxyReportClient } from "./codex-proxy-report-client";

const input = { step: "revision" as const, system: "Supported evidence only", user: "Repair advice", schema: {} };
const ready = () => Response.json({ content: { text: "Complete guidance" }, usage: { model: "worker", promptTokens: 10, completionTokens: 5 } });
const busy = () => Response.json({ error: "MODEL_RATE_LIMITED" }, { status: 429 });

test("an unspent proxy admission rejection waits and recovers using the same deadline", async () => {
  const signals: AbortSignal[] = [];
  const waits: number[] = [];
  const request = (async (_url: unknown, init: RequestInit) => {
    signals.push(init.signal!);
    return signals.length < 3 ? busy() : ready();
  }) as unknown as typeof fetch;
  const client = new CodexProxyReportClient("http://127.0.0.1:8999", "test", "manager", "worker", request,
    async (milliseconds, signal) => { waits.push(milliseconds); expect(signal).toBe(signals[0]!); });
  expect((await client.complete(input)).content).toEqual({ text: "Complete guidance" });
  expect(waits).toEqual([1000, 2000]);
  expect(new Set(signals).size).toBe(1);
});

test("persistent admission rejection has a bounded retry count and capped backoff", async () => {
  let requests = 0;
  const waits: number[] = [];
  const request = (async () => { requests++; return busy(); }) as unknown as typeof fetch;
  const client = new CodexProxyReportClient("http://127.0.0.1:8999", "test", "manager", "worker", request,
    async milliseconds => { waits.push(milliseconds); });
  await expect(client.complete(input)).rejects.toMatchObject({ code: "MODEL_RATE_LIMITED" });
  expect(requests).toBe(13);
  expect(waits).toHaveLength(12);
  expect(Math.max(...waits)).toBe(5000);
  expect(waits.reduce((sum, value) => sum + value, 0)).toBe(50000);
});

test("spent rate limits and upstream failures are never retried", async () => {
  for (const response of [Response.json({ error: "MODEL_RATE_LIMITED", usage: { model: "worker", promptTokens: 10 } }, { status: 429 }),
    Response.json({ error: "MODEL_RATE_LIMITED" }, { status: 502 })]) {
    let requests = 0;
    const request = (async () => { requests++; return response; }) as unknown as typeof fetch;
    const client = new CodexProxyReportClient("http://127.0.0.1:8999", "test", "manager", "worker", request,
      async () => { throw new Error("must not wait"); });
    await expect(client.complete(input)).rejects.toMatchObject({ code: "MODEL_RATE_LIMITED" });
    expect(requests).toBe(1);
  }
});

test("aborting an admission wait prevents another model request", async () => {
  const controller = new AbortController();
  let requests = 0;
  const request = (async () => { requests++; return busy(); }) as unknown as typeof fetch;
  const client = new CodexProxyReportClient("http://127.0.0.1:8999", "test", "manager", "worker", request,
    async (_milliseconds, signal) => { controller.abort(); signal.throwIfAborted(); });
  await expect(client.complete({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: "MODEL_ABORTED" });
  expect(requests).toBe(1);
});


test("model metadata follows clinical-review routing", () => {
  const client = new CodexProxyReportClient("http://127.0.0.1:8999", "test", "clinical", "drafting");
  for (const step of ["manager", "reviewer", "coverage"] as const) expect(client.modelForStep(step)).toBe("clinical");
  for (const step of ["writer", "revision", "summarizer", "highlighter"] as const) expect(client.modelForStep(step)).toBe("drafting");
});
