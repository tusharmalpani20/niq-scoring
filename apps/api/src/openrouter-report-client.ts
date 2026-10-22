import { REPORT_AI_MODEL } from "@niq-scoring/contracts/report-ai";
import type { ReportCall } from "./report-generation-store";
import { reportModelForStep } from "./report-model-routing";

export type ReportStep = ReportCall["step"];
export type ReasoningEffort = "medium" | "default" | null;
export const REPORT_AI_ACTIVE_MODEL = REPORT_AI_MODEL;
export const REPORT_AI_MANAGER_MODEL = "openai/gpt-6.1-sol";
export const REPORT_AI_WORKER_MODEL = "openai/gpt-6-luna";
const modelForStep = (step: ReportStep) => reportModelForStep(step, REPORT_AI_MANAGER_MODEL, REPORT_AI_WORKER_MODEL);
export type ModelCompletion = { content: unknown; usage: Omit<ReportCall, "step" | "status" | "errorCode"> & { reasoningEffort?: ReasoningEffort } };
export interface ReportTextProvider {
  readonly model?: string;
  readonly provider?: string;
  modelForStep?(step: ReportStep): string;
  complete(input: { step: ReportStep; system: string; user: string; schema: Record<string, unknown> }): Promise<ModelCompletion>;
}

export class ReportModelError extends Error {
  constructor(public readonly code: string, public readonly usage?: ModelCompletion["usage"]) { super(code); }
}

const finiteNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** OpenRouter is called only from Scoring. The credential and raw prompt are never logged. */
export class OpenRouterReportClient implements ReportTextProvider {
  readonly model = REPORT_AI_MANAGER_MODEL;
  readonly provider = "Azure";
  modelForStep = modelForStep;
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://openrouter.ai/api/v1", private readonly request = fetch) {}

  async complete(input: { step: ReportStep; system: string; user: string; schema: Record<string, unknown> }): Promise<ModelCompletion> {
    const requestModel = modelForStep(input.step);
    let reasoningEffort: Exclude<ReasoningEffort, null> = "medium";
    let lastCode = "MODEL_UNAVAILABLE";
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = performance.now();
      try {
        const requestBody = {
            model: requestModel,
            // Eight evidence-linked passages need room for the full JSON response.
            max_tokens: input.step === "reviewer" ? 1400 : input.step === "highlighter" ? 1700
              : input.step === "coverage" ? 3600 : input.step === "summarizer" ? 5000 : 6000,
            ...(reasoningEffort === "medium" ? { reasoning: { effort: "medium" } } : {}),
            provider: { only: ["azure"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true },
            response_format: { type: "json_schema", json_schema: { name: `niq_report_${input.step}`, strict: true, schema: input.schema } },
            messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }],
            usage: { include: true },
          };
        const requestOptions = {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(120_000),
        };
        let response = await this.request(`${this.baseUrl}/chat/completions`, { ...requestOptions, body: JSON.stringify(requestBody) });
        if (response.status === 400 || response.status === 422) {
          const detail = await response.clone().json().catch(() => null) as any;
          const errorText = `${detail?.error?.code ?? ""} ${detail?.error?.message ?? ""}`;
          if (/unsupported|unknown|invalid/i.test(errorText) && /reasoning|effort/i.test(errorText)) {
            reasoningEffort = "default";
            const { reasoning: _reasoning, ...fallbackBody } = requestBody;
            response = await this.request(`${this.baseUrl}/chat/completions`, { ...requestOptions, body: JSON.stringify(fallbackBody) });
          }
        }
        if (!response.ok) {
          // Record only a fixed category; provider error bodies can contain prompt text.
          const providerError: unknown = response.status >= 400 && response.status < 500
            ? await response.json().catch(() => null) : null;
          const detail = providerError && typeof providerError === "object" && "error" in providerError
            ? (providerError as { error?: unknown }).error : null;
          const providerCode = detail && typeof detail === "object" && typeof (detail as { code?: unknown }).code === "string"
            ? (detail as { code: string }).code : "";
          const safeProviderCode = /^[a-z][a-z0-9_-]{0,39}$/i.test(providerCode) ? providerCode.toUpperCase() : "";
          const category = detail && typeof detail === "object"
            ? String((detail as { code?: unknown; message?: unknown }).code ?? "") + " " +
              String((detail as { message?: unknown }).message ?? "") : "";
          lastCode = response.status === 402 ? "MODEL_PAYMENT_REQUIRED" : response.status === 429 ? "MODEL_RATE_LIMITED" : response.status >= 500 ? "MODEL_UNAVAILABLE"
            : /context.{0,20}(?:length|window)|too many tokens|token limit/i.test(category) ? "MODEL_CONTEXT_LIMIT"
            : /content.filter|content.policy|safety|moderation/i.test(category) ? "MODEL_CONTENT_FILTER"
            : /response.format|json.schema|unsupported.parameter/i.test(category) ? "MODEL_INVALID_PARAMETERS"
            : safeProviderCode ? `MODEL_REQUEST_REJECTED_${safeProviderCode}` : `MODEL_HTTP_${response.status}`;
          if ((response.status === 429 || response.status >= 500) && attempt < 2) { await Bun.sleep(250 * 2 ** attempt); continue; }
          throw new ReportModelError(lastCode);
        }
        const body: unknown = await response.json();
        if (!body || typeof body !== "object") throw new ReportModelError("MODEL_INVALID_RESPONSE");
        const record = body as Record<string, unknown>;
        if (typeof record.provider === "string" && record.provider.toLowerCase() !== "azure") {
          throw new ReportModelError("MODEL_PROVIDER_MISMATCH");
        }
        const first = Array.isArray(record.choices) ? record.choices[0] as Record<string, unknown> | undefined : undefined;
        const message = first?.message && typeof first.message === "object" ? first.message as Record<string, unknown> : undefined;
        if (typeof message?.content !== "string") throw new ReportModelError("MODEL_INVALID_RESPONSE");
        let content: unknown;
        try { content = JSON.parse(message.content); } catch { throw new ReportModelError("MODEL_INVALID_JSON"); }
        const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
        const details = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object" ? usage.completion_tokens_details as Record<string, unknown> : {};
        const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object" ? usage.prompt_tokens_details as Record<string, unknown> : {};
        return { content, usage: {
          model: typeof record.model === "string" ? record.model : requestModel,
          provider: typeof record.provider === "string" ? record.provider : null,
          generationId: typeof record.id === "string" ? record.id : null,
          promptTokens: finiteNumber(usage.prompt_tokens),
          cachedInputTokens: finiteNumber(promptDetails.cached_tokens),
          completionTokens: finiteNumber(usage.completion_tokens),
          reasoningTokens: finiteNumber(details.reasoning_tokens),
          reasoningEffort,
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
