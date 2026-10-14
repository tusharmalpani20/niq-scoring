import { z } from "zod";
import type { ReportEvidence, ReportNarrative } from "./report-content";

export const coverageFields = ["nutritionAdvice", "treatmentAdvice"] as const;
export type CoverageField = (typeof coverageFields)[number];

export type CoverageSource = { id: string; field: CoverageField; text: string };

const coverageRowSchema = z.object({
  evidenceId: z.string(),
  covered: z.boolean(),
  missing: z.array(z.string().trim().min(1).max(220)).max(12),
}).strict();
const coverageSchema = z.object({ rows: z.array(coverageRowSchema).max(150) }).strict();

export const coverageJsonSchema = {
  type: "object", additionalProperties: false, required: ["rows"],
  properties: { rows: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["evidenceId", "covered", "missing"], properties: {
      evidenceId: { type: "string" }, covered: { type: "boolean" },
      missing: { type: "array", items: { type: "string" } },
    } } } },
};

/** These are the source rows whose advice the patient-facing report must retain. */
export function requiredCoverageSources(evidence: ReportEvidence[]): CoverageSource[] {
  const sources: CoverageSource[] = [];
  for (const item of evidence) {
    if (item.id.startsWith("rule:nutrition:")) sources.push({ ...item, field: "nutritionAdvice" });
    else if (item.id.startsWith("rule:class:"))
      sources.push({ ...item, field: "treatmentAdvice" });
  }
  return sources;
}

export type InterventionSummary = { evidenceId: string; text: string };
const summarySchema = z.object({ rows: z.array(z.object({ evidenceId: z.string(), text: z.string().trim().min(1).max(1800) }).strict()).max(150) }).strict();
export const interventionSummaryJsonSchema = {
  type: "object", additionalProperties: false, required: ["rows"],
  properties: { rows: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["evidenceId", "text"], properties: { evidenceId: { type: "string" }, text: { type: "string" } },
  } } },
};

/** Keep exactly one supported, conditional summary for each matched candidate. */
export function assessInterventionSummaries(value: unknown, sources: ReportEvidence[]): {
  rows: InterventionSummary[] | null; issues: string[];
} {
  const parsed = summarySchema.safeParse(value);
  if (!parsed.success || parsed.data.rows.length !== sources.length)
    return { rows: null, issues: ["INVALID_INTERVENTION_SUMMARIES"] };
  const sourceById = new Map(sources.map(item => [item.id, item.text]));
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const row of parsed.data.rows) {
    const source = sourceById.get(row.evidenceId);
    if (!source || seen.has(row.evidenceId)) return { rows: null, issues: ["INVALID_INTERVENTION_SUMMARIES"] };
    seen.add(row.evidenceId);
    const sourceNumbers = new Set(source.match(/\d+(?:\.\d+)?/gu) ?? []);
    if ((row.text.match(/\d+(?:\.\d+)?/gu) ?? []).some(number => !sourceNumbers.has(number)))
      issues.push(`${row.evidenceId}:UNSUPPORTED_NUMBER`);
    if (/\b(?:hba1c|a1c|glycated\s+ha?emoglobin)\b/i.test(row.text))
      issues.push(`${row.evidenceId}:EXCLUDED_REPORT_TERM`);
    if (/\b(?:you have developed|you are experiencing|chemotherapy has caused)\b/i.test(row.text))
      issues.push(`${row.evidenceId}:POSSIBLE_EFFECT_AS_CONFIRMED`);
  }
  return { rows: issues.length ? null : parsed.data.rows, issues };
}

export function assessInterventionSummaryCoverage(value: unknown, sources: ReportEvidence[], summaries: InterventionSummary[]): {
  accepted: boolean; gaps: Array<{ id: string; missing: string[] }>; invalid: boolean;
} {
  const parsed = coverageSchema.safeParse(value);
  if (!parsed.success || parsed.data.rows.length !== sources.length || summaries.length !== sources.length)
    return { accepted: false, gaps: [], invalid: true };
  const sourceIds = new Set(sources.map(item => item.id));
  const summaryIds = new Set(summaries.map(item => item.evidenceId));
  if (sourceIds.size !== sources.length || summaryIds.size !== sources.length ||
      [...sourceIds].some(id => !summaryIds.has(id)))
    return { accepted: false, gaps: [], invalid: true };
  const seen = new Set<string>();
  const gaps: Array<{ id: string; missing: string[] }> = [];
  for (const row of parsed.data.rows) {
    if (!sourceIds.has(row.evidenceId) || seen.has(row.evidenceId) || row.covered === (row.missing.length > 0))
      return { accepted: false, gaps: [], invalid: true };
    seen.add(row.evidenceId);
    if (!row.covered) gaps.push({ id: row.evidenceId, missing: row.missing });
  }
  return { accepted: gaps.length === 0, gaps, invalid: false };
}

export type CoverageGap = { id: string; field: CoverageField; missing: string[] };

/** A cited ID is not enough: the independent audit must assess the source's meaning. */
export function assessCoverage(value: unknown, sources: CoverageSource[], narrative: ReportNarrative): {
  accepted: boolean; gaps: CoverageGap[]; invalid: boolean;
} {
  const parsed = coverageSchema.safeParse(value);
  if (!parsed.success || parsed.data.rows.length !== sources.length) return { accepted: false, gaps: [], invalid: true };
  const byId = new Map(sources.map(source => [source.id, source]));
  const seen = new Set<string>();
  const gaps: CoverageGap[] = [];
  for (const row of parsed.data.rows) {
    const source = byId.get(row.evidenceId);
    if (!source || seen.has(row.evidenceId) || row.covered === (row.missing.length > 0))
      return { accepted: false, gaps: [], invalid: true };
    seen.add(row.evidenceId);
    // A row cannot be covered by prose in another section or an empty passage.
    if (!narrative[source.field].text.trim() || !narrative[source.field].evidenceIds.includes(source.id))
      gaps.push({ id: source.id, field: source.field, missing: ["The matching advice is absent from its report section."] });
    else if (!row.covered) gaps.push({ id: source.id, field: source.field, missing: row.missing });
  }
  return { accepted: gaps.length === 0, gaps, invalid: false };
}
