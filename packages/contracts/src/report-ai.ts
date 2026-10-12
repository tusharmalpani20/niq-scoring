import { z } from "zod";

export const REPORT_AI_MODEL = "openai/gpt-6-luna" as const;
export const REPORT_AI_SCHEMA_VERSION = 1 as const;

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
    writerPrompt: "Write concise, compassionate plain-language report text from the supplied verified facts and matched guidance. Use only supplied evidence IDs.",
    reviewerPrompt: "Check each statement against the supplied verified facts and matched guidance. Identify unsupported or misleading wording and request a targeted revision.",
  };
}
