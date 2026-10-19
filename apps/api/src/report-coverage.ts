import { z } from "zod";
import { normalizeReportSentenceStarts } from "./report-editorial";
import { narrativeFieldNames, type ReportEvidence, type ReportNarrative } from "./report-content";

export const coverageFields = ["nutritionAdvice", "treatmentAdvice"] as const;
export type CoverageField = (typeof coverageFields)[number];

export type CoverageSource = { id: string; field: CoverageField; text: string };

// Long treatment rows can have many distinct actions. Keep the runtime and
// provider schemas aligned so valid detail reaches clinical adjudication.
const MAX_COVERAGE_GAPS_PER_SOURCE = 32;
const coverageRowSchema = z.object({
  evidenceId: z.string(),
  covered: z.boolean(),
  missing: z.array(z.string().trim().min(1).max(500)).max(MAX_COVERAGE_GAPS_PER_SOURCE),
}).strict();
const coverageSchema = z.object({ rows: z.array(coverageRowSchema).max(150) }).strict();

export const coverageJsonSchema = {
  type: "object", additionalProperties: false, required: ["rows"],
  properties: { rows: { type: "array", maxItems: 150, items: { type: "object", additionalProperties: false,
    required: ["evidenceId", "covered", "missing"], properties: {
      evidenceId: { type: "string" }, covered: { type: "boolean" },
      missing: { type: "array", maxItems: MAX_COVERAGE_GAPS_PER_SOURCE, items: { type: "string", minLength: 1, maxLength: 500 } },
    } } } },
};

/** These are the source rows whose advice the patient-facing report must retain. */
export function requiredCoverageSources(evidence: ReportEvidence[]): CoverageSource[] {
  const sources: CoverageSource[] = [];
  for (const item of evidence) {
    if (item.id.startsWith("rule:nutrition:")) sources.push({ ...item, field: "nutritionAdvice" });
    else if (["rule:status:", "rule:treatment:", "rule:class:", "rule:exception:"].some(prefix => item.id.startsWith(prefix)))
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
    if (/\b(?:refer to|see (?:the |our |your )?(?:reported symptom|food safety|monitoring|red.flags|another section)|a related symptom was reported separately|their cause is not established|patient.reported mouth symptoms)\b/i.test(row.text)
      || /\[[^\]]+\]\(/u.test(row.text))
      issues.push(`${row.evidenceId}:INCOMPLETE_REFERENCED_CARE`);
    if (/\b(?:hba1c|a1c|glycated\s+ha?emoglobin)\b/i.test(row.text))
      issues.push(`${row.evidenceId}:EXCLUDED_REPORT_TERM`);
    if (/\b(?:you have developed|you are experiencing|chemotherapy has caused)\b/i.test(row.text))
      issues.push(`${row.evidenceId}:POSSIBLE_EFFECT_AS_CONFIRMED`);
  }
  return { rows: issues.length ? null : parsed.data.rows.map(row => ({...row, text: normalizeReportSentenceStarts(row.text)})), issues };
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

export type CoverageGap = { id: string; field: CoverageField; missing: string[]; component?: string };

/** A cited ID is not enough: the independent audit must assess the source's meaning. */
export function assessCoverage(value: unknown, sources: CoverageSource[], narrative: ReportNarrative, allowedComponents?: readonly string[]): {
  accepted: boolean; gaps: CoverageGap[]; invalid: boolean;
} {
  const parsed = coverageSchema.safeParse(value);
  if (!parsed.success || parsed.data.rows.length !== sources.length) return { accepted: false, gaps: [], invalid: true };
  const byId = new Map(sources.map(source => [source.id, source]));
  const seen = new Set<string>();
  const gaps: CoverageGap[] = [];
  const componentIds = new Set<string>(allowedComponents ?? narrativeFieldNames);
  for (const row of parsed.data.rows) {
    const source = byId.get(row.evidenceId);
    if (!source || seen.has(row.evidenceId) || row.covered === (row.missing.length > 0))
      return { accepted: false, gaps: [], invalid: true };
    seen.add(row.evidenceId);
    const groups = new Map<string, string[]>();
    for (const missing of row.missing) {
      const targeted = missing.match(/^\[([^\]]+)\]\s+(.+)$/su);
      // Persisted/offline legacy audits may lack a prefix. Live assembled
      // callers supply allowedComponents and require explicit routing at runtime.
      const component = targeted?.[1] ?? source.field;
      if ((allowedComponents && !targeted) || (missing.startsWith("[") && !targeted) || !componentIds.has(component))
        return { accepted: false, gaps: [], invalid: true };
      const group = groups.get(component) ?? [];
      group.push(targeted?.[2] ?? missing);
      groups.set(component, group);
    }
    // The semantic audit considers the full report. Ownership rules determine
    // where an action belongs, while equivalent shared targets need not repeat.
    const passages = narrativeFieldNames.map(field => narrative[field]);
    const designated = narrative[source.field];
    const cited = passages.some(part => part?.evidenceIds.includes(source.id));
    if ((!designated.text.trim() && !passages.some(part => part?.text.trim())) || !cited)
      gaps.push({ id: source.id, field: source.field, missing: ["The matching advice is absent from its report section."] });
    else if (!row.covered) for (const [component, missing] of groups)
      gaps.push({ id: source.id, field: source.field, component, missing });
  }
  return { accepted: gaps.length === 0, gaps, invalid: false };
}
