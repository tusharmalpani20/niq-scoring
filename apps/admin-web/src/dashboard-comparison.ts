type Counts = { assessments: number; faceScans: number; failedRequests: number };
type Period = { previous: string; asOf: string; comparisonEnd?: string | null };

export function metricComparison(period: Period, previous: Counts | null | undefined, metric: keyof Counts) {
  if (!previous) return null;
  if (period.comparisonEnd) return { end: period.comparisonEnd, count: previous[metric] };
  if (period.comparisonEnd === null || previous[metric] !== 0) return null;

  // Older APIs return full-month totals. Zero for the full month also means zero
  // for the matching partial month; any nonzero total needs the updated API.
  const start = new Date(`${period.previous}-01T00:00:00Z`);
  const asOf = new Date(period.asOf);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), asOf.getUTCDate(), asOf.getUTCHours(), asOf.getUTCMinutes(), asOf.getUTCSeconds(), asOf.getUTCMilliseconds()));
  if (end.getUTCFullYear() !== start.getUTCFullYear() || end.getUTCMonth() !== start.getUTCMonth()) return null;
  return { end: end.toISOString(), count: 0 };
}
