import { setTimeout as delay } from "node:timers/promises";
import { reportModelForStep } from "./report-model-routing";
import { ReportModelError, type ModelCompletion, type ReportStep, type ReportTextProvider } from "./openrouter-report-client";

const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const waitForAdmission = (milliseconds: number, signal: AbortSignal) => delay(milliseconds, undefined, { signal });

/** Retry only the proxy's unspent HTTP 429 admission rejection, never inference. */
export class CodexProxyReportClient implements ReportTextProvider {
  readonly provider = "codex-subscription";
  constructor(private readonly baseUrl: string, private readonly token: string, public readonly model: string, private readonly workerModel: string, private readonly request = fetch, private readonly wait = waitForAdmission) {}
  modelForStep(step: ReportStep): string { return reportModelForStep(step, this.model, this.workerModel); }

  async complete(input: { step: ReportStep; system: string; user: string; schema: Record<string, unknown>; signal?: AbortSignal }): Promise<ModelCompletion> {
    const started = performance.now();
    const deadline = AbortSignal.timeout(400_000);
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    const { step, system, user, schema } = input;
    try {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        const response = await this.request(`${this.baseUrl.replace(/\/$/, "")}/v1/report/completions`, {
          method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ step, system, user, schema }), signal,
        });
        const body: unknown = await response.json().catch(() => null);
        const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
        // The proxy returns 429 before admitting a call; inference errors use
        // HTTP 502. Reuse one deadline across admission waits and inference so a
        // busy proxy cannot extend the report worker lease indefinitely.
        if (response.status === 429 && record?.error === "MODEL_RATE_LIMITED"
          && !record.usage && attempt < 12) {
          await this.wait(Math.min(1_000 * (attempt + 1), 5_000), signal);
          continue;
        }
        const usage = record?.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : null;
        const measuredUsage: ModelCompletion["usage"] | undefined = usage && typeof usage.model === "string" && usage.model.length > 0 && usage.model.length <= 128 ? {
          model: usage.model, provider: this.provider,
          generationId: typeof usage.generationId === "string" ? usage.generationId : null,
          promptTokens: count(usage.promptTokens), completionTokens: count(usage.completionTokens),
          reasoningTokens: count(usage.reasoningTokens),
          reasoningEffort: usage.reasoningEffort === "medium" || usage.reasoningEffort === "default" ? usage.reasoningEffort : null,
          cachedInputTokens: count(usage.cachedInputTokens),
          costUsd: null, latencyMs: Math.round(performance.now() - started),
        } : undefined;
        if (!response.ok) {
          const code = typeof record?.error === "string" && /^MODEL_[A-Z0-9_]{1,64}$/.test(record.error)
            ? record.error : response.status === 429 ? "MODEL_RATE_LIMITED" : "MODEL_UNAVAILABLE";
          throw new ReportModelError(code, measuredUsage);
        }
        if (!record || !("content" in record) || !measuredUsage) {
          throw new ReportModelError("MODEL_INVALID_RESPONSE", measuredUsage);
        }
        return { content: record.content, usage: measuredUsage };
      }
    } catch (error) {
      if (error instanceof ReportModelError) throw error;
      throw new ReportModelError(signal.aborted ? (deadline.aborted ? "MODEL_TIMEOUT" : "MODEL_ABORTED") : error instanceof DOMException && error.name === "TimeoutError" ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE");
    }
  }
}
