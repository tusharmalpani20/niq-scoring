import {
  narrativeFieldNames, narrativeSchema, normalizeNarrativePunctuation, validateNarrative,
  type CompleteReportNarrative, type ReportEvidence, type ReportNarrative,
} from "./report-content";
import { plainNarrative } from "./report-highlights";

type NarrativeField = (typeof narrativeFieldNames)[number];
type SectionOrigin = "agent" | "rule_fallback";
export type NarrativeSectionRecovery = {
  candidate: CompleteReportNarrative | null;
  replacedFields: NarrativeField[];
  origins: Partial<Record<NarrativeField, SectionOrigin>>;
  issues: string[];
  /** Structurally safe for another clinical review, not approval for publication. */
  canPreserve: boolean;
};

/**
 * Recover explicitly rejected sections without discarding unrelated agent prose.
 * Deterministic checks cannot establish clinical approval: the caller must review
 * the assembled candidate and rerun coverage before publishing it. Unknown/global
 * failures remain unresolved because they do not identify a safe replacement scope.
 */
export function recoverNarrativeSections(input: {
  candidate: unknown;
  issueCodes: readonly string[];
  fallbackNarrative: ReportNarrative;
  evidence: ReportEvidence[];
}): NarrativeSectionRecovery {
  const parsed = narrativeSchema.safeParse(input.candidate);
  if (!parsed.success) return {
    candidate: null, replacedFields: [], origins: {}, canPreserve: false,
    issues: validateNarrative(input.candidate, input.evidence).issues,
  };
  const candidate = normalizeNarrativePunctuation(plainNarrative(parsed.data)) as CompleteReportNarrative;
  const originalIssues = [...input.issueCodes, ...validateNarrative(candidate, input.evidence).issues];
  const flagged = new Set<NarrativeField>();
  const unresolved: string[] = [];
  for (const issue of originalIssues) {
    const field = issue.split(":", 1)[0];
    if (narrativeFieldNames.includes(field as NarrativeField)) flagged.add(field as NarrativeField);
    else unresolved.push(issue);
  }
  const origins = Object.fromEntries(narrativeFieldNames.map(field => [field, "agent"])) as Record<NarrativeField, SectionOrigin>;
  const fallbackParsed = narrativeSchema.safeParse(input.fallbackNarrative);
  if (!fallbackParsed.success) return {
    candidate, replacedFields: [], origins, canPreserve: false,
    issues: [...new Set([...unresolved, "INVALID_SECTION_FALLBACK_SCHEMA"])],
  };
  const fallback = normalizeNarrativePunctuation(plainNarrative(fallbackParsed.data)) as CompleteReportNarrative;
  const merged = { ...candidate };
  const replacedFields = narrativeFieldNames.filter(field => flagged.has(field));
  for (const field of replacedFields) {
    merged[field] = { ...fallback[field], evidenceIds: [...fallback[field].evidenceIds] };
    origins[field] = "rule_fallback";
  }
  const checked = validateNarrative(merged, input.evidence);
  const issues = [...new Set([...unresolved, ...checked.issues])];
  return { candidate: merged, replacedFields, origins, issues, canPreserve: issues.length === 0 };
}
