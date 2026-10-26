import { REPORT_AI_MODEL } from "@niq-scoring/contracts/report-ai";
import type { ReportCall } from "./report-generation-store";
import { reportModelForStep } from "./report-model-routing";

export type ReportStep = ReportCall["step"];
export type ReasoningEffort = "medium" | "default" | null;
export const REPORT_AI_ACTIVE_MODEL = REPORT_AI_MODEL;
export const REPORT_AI_MANAGER_MODEL = "openai/gpt-6-luna-pro";
export const REPORT_AI_WORKER_MODEL = "openai/gpt-6-luna";
const modelForStep = (step: ReportStep) => reportModelForStep(step, REPORT_AI_MANAGER_MODEL, REPORT_AI_WORKER_MODEL);
export type ModelCompletion = { content: unknown; usage: Omit<ReportCall, "step" | "status" | "errorCode"> & { reasoningEffort?: ReasoningEffort } };
export type ProviderAttempt = {
  attempt: number; maxTokens: number; finishReason: string | null;
  errorCode: string | null; usage: ModelCompletion["usage"];
};
export type ReportModelInput = {
  step: ReportStep; system: string; user: string; schema: Record<string, unknown>;
  beforeAttempt?: () => Promise<void>;
  onAttempt?: (attempt: ProviderAttempt) => Promise<void>;
};
export interface ReportTextProvider {
  readonly model?: string;
  readonly provider?: string;
  modelForStep?(step: ReportStep): string;
  complete(input: ReportModelInput): Promise<ModelCompletion>;
}

// Budgets include internal reasoning AND visible JSON. These are output ceilings,
// not target lengths; clinical schemas and review requirements remain unchanged.
export const REPORT_OUTPUT_BUDGETS = {
  manager: { initial: 8000, maximum: 32000 },
  writer: { initial: 8000, maximum: 32000 },
  revision: { initial: 8000, maximum: 32000 },
  reviewer: { initial: 6000, maximum: 24000 },
  coverage: { initial: 8000, maximum: 32000 },
  summarizer: { initial: 8000, maximum: 32000 },
  highlighter: { initial: 4000, maximum: 16000 },
} satisfies Record<ReportStep, { initial: number; maximum: number }>;

export class ReportModelError extends Error {
  constructor(public readonly code: string, public readonly usage?: ModelCompletion["usage"]) { super(code); }
}

const finiteNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Both HTTP errors and errors in HTTP 200 bodies use the same safe categories.
 * Inspect provider text only to classify it; never retain it in diagnostics. */
function providerErrorCode(httpStatus: number, detail: unknown, reasoningEffort: ReasoningEffort): string {
  const error = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
  const rawCode = error.code;
  const embeddedStatus = typeof rawCode === "number" ? rawCode
    : typeof rawCode === "string" && /^[45]\d{2}$/.test(rawCode) ? Number(rawCode) : null;
  // Real non-200 HTTP status takes precedence over an embedded status.
  const status = httpStatus === 200 && embeddedStatus !== null && Number.isInteger(embeddedStatus)
    && embeddedStatus >= 400 && embeddedStatus <= 599 ? embeddedStatus : httpStatus;
  const providerCode = typeof rawCode === "string" ? rawCode : "";
  const safeProviderCode = /^[a-z][a-z0-9_-]{0,39}$/i.test(providerCode) ? providerCode.toUpperCase() : "";
  const category = `${typeof rawCode === "string" || typeof rawCode === "number" ? rawCode : ""} ${typeof error.message === "string" ? error.message : ""}`;
  if ((status === 400 || status === 422) && reasoningEffort === "medium"
    && /unsupported|unknown|invalid/i.test(category) && /reasoning|effort/i.test(category)) return "MODEL_REASONING_UNSUPPORTED";
  if (status === 402) return "MODEL_PAYMENT_REQUIRED";
  if (status === 429) return "MODEL_RATE_LIMITED";
  if (status >= 500) return "MODEL_UNAVAILABLE";
  if (/context.{0,20}(?:length|window)|too many tokens|token limit/i.test(category)) return "MODEL_CONTEXT_LIMIT";
  if (/content.filter|content.policy|safety|moderation/i.test(category)) return "MODEL_CONTENT_FILTER";
  if (/response.format|json.schema|unsupported.parameter/i.test(category)) return "MODEL_INVALID_PARAMETERS";
  return safeProviderCode ? `MODEL_REQUEST_REJECTED_${safeProviderCode}` : status === 200 ? "MODEL_UNAVAILABLE" : `MODEL_HTTP_${status}`;
}

/** OpenRouter is called only from Scoring. The credential and raw prompt are never logged. */
export class OpenRouterReportClient implements ReportTextProvider {
  readonly model = REPORT_AI_MANAGER_MODEL;
  readonly provider = "Azure";
  modelForStep = modelForStep;
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://openrouter.ai/api/v1", private readonly request = fetch) {}

  async complete(input: ReportModelInput): Promise<ModelCompletion> {
    const requestModel = modelForStep(input.step);
    let reasoningEffort: Exclude<ReasoningEffort, null> = "medium";
    const budget = REPORT_OUTPUT_BUDGETS[input.step];
    let maxTokens = budget.initial;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Lease/trace failures are not provider failures and must not be retried.
      await input.beforeAttempt?.();
      const started = performance.now();
      let measuredUsage: ModelCompletion["usage"] = { model: requestModel, provider: this.provider, generationId: null,
        promptTokens: null, completionTokens: null, reasoningTokens: null, costUsd: null, latencyMs: 0, reasoningEffort };
      let finishReason: string | null = null;
      let completion: ModelCompletion | undefined;
      let failure: ReportModelError | undefined;
      try {
        const requestBody = {
            model: requestModel,
            max_tokens: maxTokens,
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
        const response = await this.request(`${this.baseUrl}/chat/completions`, { ...requestOptions, body: JSON.stringify(requestBody) });
        const body: unknown = await response.json().catch((error: unknown) => {
          // A non-JSON gateway reply may still carry a decisive HTTP status.
          // Body-read transport failures must retain their timeout/error cause.
          if (error instanceof SyntaxError) return null;
          throw error;
        });
        const validBody = body !== null && typeof body === "object" && !Array.isArray(body);
        const record = validBody ? body as Record<string, unknown> : {};
        const first = Array.isArray(record.choices) ? record.choices[0] as Record<string, unknown> | undefined : undefined;
        const message = first?.message && typeof first.message === "object" ? first.message as Record<string, unknown> : undefined;
        const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
        const details = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object" ? usage.completion_tokens_details as Record<string, unknown> : {};
        const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object" ? usage.prompt_tokens_details as Record<string, unknown> : {};
        measuredUsage = {
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
        };
        // Preserve billing before parsing; a truncated/refused reply is still billed.
        const reason = first?.finish_reason;
        finishReason = typeof reason === "string" && ["stop", "length", "content_filter", "error", "tool_calls", "function_call"].includes(reason) ? reason : null;
        if (!response.ok || record.error) throw new ReportModelError(providerErrorCode(response.status, record.error, reasoningEffort));
        if (!validBody) throw new ReportModelError("MODEL_INVALID_RESPONSE");
        if (typeof record.provider === "string" && record.provider.toLowerCase() !== "azure") throw new ReportModelError("MODEL_PROVIDER_MISMATCH");
        if (finishReason === "length") throw new ReportModelError("MODEL_OUTPUT_LIMIT");
        if (finishReason === "content_filter") throw new ReportModelError("MODEL_CONTENT_FILTER");
        if (typeof message?.refusal === "string" && message.refusal.length) throw new ReportModelError("MODEL_REFUSAL");
        if (finishReason === "error") throw new ReportModelError("MODEL_UNAVAILABLE");
        if (finishReason === "tool_calls" || finishReason === "function_call") throw new ReportModelError("MODEL_INVALID_RESPONSE");
        if (typeof message?.content !== "string") throw new ReportModelError("MODEL_INVALID_RESPONSE");
        let content: unknown;
        try { content = JSON.parse(message.content); } catch { throw new ReportModelError("MODEL_INVALID_JSON"); }
        completion = { content, usage: measuredUsage };
      } catch (error) {
        measuredUsage.latencyMs = Math.round(performance.now() - started);
        const code = error instanceof ReportModelError ? error.code
          : error instanceof DOMException && error.name === "TimeoutError" ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE";
        failure = new ReportModelError(code, measuredUsage);
      }
      // Outside the inference catch: a trace/lease failure must NEVER trigger more inference.
      await input.onAttempt?.({ attempt: attempt + 1, maxTokens, finishReason, errorCode: failure?.code ?? null, usage: measuredUsage });
      if (completion) return completion;
      const code = failure!.code;
      const retryable = ["MODEL_OUTPUT_LIMIT", "MODEL_INVALID_RESPONSE", "MODEL_INVALID_JSON", "MODEL_RATE_LIMITED",
        "MODEL_UNAVAILABLE", "MODEL_TIMEOUT", "MODEL_REASONING_UNSUPPORTED"].includes(code);
      if (!retryable || attempt === 2 || (code === "MODEL_OUTPUT_LIMIT" && maxTokens >= budget.maximum)) throw failure;
      if (code === "MODEL_OUTPUT_LIMIT") maxTokens = Math.min(maxTokens * 2, budget.maximum);
      if (code === "MODEL_REASONING_UNSUPPORTED") reasoningEffort = "default";
      await Bun.sleep(250 * 2 ** attempt);
    }
    throw new ReportModelError("MODEL_UNAVAILABLE");
  }
}
