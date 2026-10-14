import { REPORT_AI_MODEL } from "@niq-scoring/contracts/report-ai";
import type { ReportCall } from "./report-generation-store";

export type ReportStep = ReportCall["step"];
export type ModelCompletion = { content: unknown; usage: Omit<ReportCall, "step" | "status" | "errorCode"> };
export interface ReportTextProvider {
  complete(input: { step: ReportStep; system: string; user: string; schema: Record<string, unknown> }): Promise<ModelCompletion>;
}

export class ReportModelError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const finiteNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** OpenRouter is called only from Scoring. The credential and raw prompt are never logged. */
export class OpenRouterReportClient implements ReportTextProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://openrouter.ai/api/v1", private readonly request = fetch) {}

  async complete(input: { step: ReportStep; system: string; user: string; schema: Record<string, unknown> }): Promise<ModelCompletion> {
    let lastCode = "MODEL_UNAVAILABLE";
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = performance.now();
      try {
        const response = await this.request(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: REPORT_AI_MODEL,
            // Eight evidence-linked passages need room for the full JSON response.
            max_tokens: input.step === "reviewer" ? 1400 : input.step === "highlighter" ? 1700
              : input.step === "coverage" ? 2600 : 6000,
            reasoning: { effort: "low" },
            provider: { only: ["azure"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true },
            response_format: { type: "json_schema", json_schema: { name: `niq_report_${input.step}`, strict: true, schema: input.schema } },
            messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }],
            usage: { include: true },
          }),
          signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) {
          lastCode = response.status === 429 ? "MODEL_RATE_LIMITED" : response.status >= 500 ? "MODEL_UNAVAILABLE" : "MODEL_REQUEST_REJECTED";
          if ((response.status === 429 || response.status >= 500) && attempt < 2) { await Bun.sleep(250 * 2 ** attempt); continue; }
          throw new ReportModelError(lastCode);
        }
        const body: unknown = await response.json();
        if (!body || typeof body !== "object") throw new ReportModelError("MODEL_INVALID_RESPONSE");
        const record = body as Record<string, unknown>;
        if (typeof record.provider === "string" && !/^azure(?:$|[-_\s(])/i.test(record.provider)) {
          throw new ReportModelError("MODEL_PROVIDER_MISMATCH");
        }
        const first = Array.isArray(record.choices) ? record.choices[0] as Record<string, unknown> | undefined : undefined;
        const message = first?.message && typeof first.message === "object" ? first.message as Record<string, unknown> : undefined;
        if (typeof message?.content !== "string") throw new ReportModelError("MODEL_INVALID_RESPONSE");
        let content: unknown;
        try { content = JSON.parse(message.content); } catch { throw new ReportModelError("MODEL_INVALID_JSON"); }
        const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
        const details = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object" ? usage.completion_tokens_details as Record<string, unknown> : {};
        return { content, usage: {
          model: REPORT_AI_MODEL,
          provider: typeof record.provider === "string" ? record.provider : null,
          generationId: typeof record.id === "string" ? record.id : null,
          promptTokens: finiteNumber(usage.prompt_tokens),
          completionTokens: finiteNumber(usage.completion_tokens),
          reasoningTokens: finiteNumber(details.reasoning_tokens),
          costUsd: finiteNumber(usage.cost),
          latencyMs: Math.round(performance.now() - started),
        } };
      } catch (error) {
        if (error instanceof ReportModelError) {
          // The provider occasionally returns a successful response with no
          // usable content. Retry that transient failure, but still fail closed.
          if ((error.code === "MODEL_INVALID_RESPONSE" || error.code === "MODEL_INVALID_JSON") && attempt < 2) {
            lastCode = error.code;
            await Bun.sleep(250 * 2 ** attempt);
            continue;
          }
          throw error;
        }
        lastCode = error instanceof DOMException && error.name === "TimeoutError" ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE";
        if (attempt < 2) { await Bun.sleep(250 * 2 ** attempt); continue; }
      }
    }
    throw new ReportModelError(lastCode);
  }
}
