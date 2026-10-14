import { ReportModelError, type ModelCompletion, type ReportStep, type ReportTextProvider } from "./openrouter-report-client";

const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Local development transport. The proxy owns retries; never retry a spent call here. */
export class CodexProxyReportClient implements ReportTextProvider {
  readonly provider = "codex-subscription";
  constructor(private readonly baseUrl: string, private readonly token: string, public readonly model: string, private readonly workerModel: string, private readonly request = fetch) {}
  modelForStep(step: ReportStep): string { return step === "manager" ? this.model : this.workerModel; }

  async complete(input: { step: ReportStep; system: string; user: string; schema: Record<string, unknown> }): Promise<ModelCompletion> {
    const started = performance.now();
    try {
      const response = await this.request(`${this.baseUrl.replace(/\/$/, "")}/v1/report/completions`, {
        method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input), signal: AbortSignal.timeout(400_000),
      });
      const body: unknown = await response.json().catch(() => null);
      const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
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
    } catch (error) {
      if (error instanceof ReportModelError) throw error;
      throw new ReportModelError(error instanceof DOMException && error.name === "TimeoutError" ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE");
    }
  }
}
