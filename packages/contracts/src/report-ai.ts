import { z } from "zod";

export const REPORT_AI_MODEL = "openai/gpt-6-luna" as const;
export const REPORT_AI_SCHEMA_VERSION = 4 as const;

/** Editable wording belongs to a rule version. Safety and evidence rules stay in server code. */
export const reportAiConfigSchema = z.object({
  enabled: z.boolean(),
  model: z.literal(REPORT_AI_MODEL),
  writerPrompt: z.string().trim().min(10).max(4000),
  reviewerPrompt: z.string().trim().min(10).max(4000),
}).strict();

export type ReportAiConfig = z.infer<typeof reportAiConfigSchema>;

export function initialReportAiConfig(): ReportAiConfig {
  return {
    enabled: true,
    model: REPORT_AI_MODEL,
    writerPrompt: "Write concise, compassionate patient-facing text from the supplied verified facts and matched guidance. Explain relevant care plan rules in clear sentences without copying their raw wording. Keep supported numbers and units exact. Cite the evidence IDs for every passage.",
    reviewerPrompt: "Check each statement against the supplied verified facts and matched guidance. Flag unsupported claims, misleading wording, and care plan text copied from raw rules. Request a targeted revision for each issue.",
  };
}
