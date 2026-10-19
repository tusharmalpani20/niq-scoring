/** Internal per-report decisions. Snapshots preserve the wording and citations
 * reviewed at the time; they are not new clinical evidence or patient content. */
export type ReportAdjudication = {
  issues: Array<{field: string; code: string; reason?: string | undefined; evidenceIds: string[]}>;
  retainedIssueIndexes: number[];
  reviewedFields: Array<{field: string; text: string}>;
};

export const REPORT_ADJUDICATION_POLICY = `Apply earlier report adjudications consistently across narrative, card, assembled and final review and recovery. An earlier dismissed request to move complete supported advice between acceptable narrative sections is settled for that meaning; do not reopen it solely to prefer the checklist's initial destination. The checklist suggests an initial home, not a reason to relocate care already accepted in an appropriate section. Compare the exact reviewed snapshots with the current text. An unrelated edit or a changed field does not by itself invalidate a settled placement. A newly discovered clinical error, missing source meaning or qualification, unsafe action, or a concrete unsafe earlier judgment may still require repair: identify the exact current phrase or omission and its supporting source, and explain that clinical difference from the earlier concern. Prior decisions never waive deterministic checks or required complete care inside each relevant effect card. Preserve clinical facts, targets, safety and ownership requirements; do not copy this review history into patient-facing text.`;

export function reportAdjudicationRecords(history: readonly ReportAdjudication[], draft: unknown) {
  const current = draft && typeof draft === "object" ? draft as Record<string, unknown> : {};
  return history.map(row => ({
    ...row, unchangedFields: row.reviewedFields.filter(part => JSON.stringify(current[part.field]) === part.text).map(part => part.field),
  }));
}

export function reportAdjudicationContext(history: readonly ReportAdjudication[], draft: unknown): string {
  if (!history.length) return "";
  return `${REPORT_ADJUDICATION_POLICY}\nEarlier report adjudications: ${JSON.stringify(reportAdjudicationRecords(history, draft))}`;
}

export type ReportAdjudicationGap = { id: string; component: string; missing: string[] };

/** A partly retained source/component gap remains retained as a whole. This
 * conservative record cannot turn a manager's partial repair into a waiver. */
export function rememberCoverageAdjudication(history: ReportAdjudication[], original: ReportAdjudicationGap[],
  verified: ReportAdjudicationGap[], draft: Record<string, unknown>) {
  if (!original.length) return;
  const sourceIds = new Set(original.map(gap => gap.id));
  const fields = new Set(original.map(gap => gap.component));
  for (const [field, part] of Object.entries(draft)) {
    if (part && typeof part === "object" && "evidenceIds" in part && Array.isArray(part.evidenceIds) &&
      part.evidenceIds.some(id => sourceIds.has(id))) fields.add(field);
  }
  history.push({
    issues: original.map(gap => ({ field: gap.component, code: "COVERAGE_GAP",
      reason: gap.missing.join(" "), evidenceIds: [gap.id] })),
    retainedIssueIndexes: original.flatMap((gap, index) => verified.some(row =>
      row.id === gap.id && row.component === gap.component) ? [index] : []),
    reviewedFields: [...fields].filter(field => draft[field] !== undefined).map(field => ({ field, text: JSON.stringify(draft[field]) })),
  });
}
