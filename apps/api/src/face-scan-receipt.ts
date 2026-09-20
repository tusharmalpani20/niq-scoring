/** Preserve supported result blocks for repair without retaining request secrets or capture echoes. */
export function allowlistedFaceScanReceipt(body: object): unknown {
  const source = body as Record<string, unknown>;
  const event = asRecord(source.event_data);
  const metadata = asRecord(event.metadata);
  const clean = (value: unknown, depth = 0): unknown => {
    if (depth > 12) return "[unsupported nesting]";
    if (Array.isArray(value)) return value.map(entry => clean(entry, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/api.?key|secret|token|authorization|password|raw_intensity|ppg_time|screenshot|video|image/i.test(key))
      .map(([key, entry]) => [key, clean(entry, depth + 1)]));
    return value;
  };
  const pick = (record: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(key => key in record).map(key => [key, clean(record[key])]));
  return {
    scan_id: source.scan_id,
    scan_completion_time: source.scan_completion_time ?? null,
    event_data: {
      ...pick(event, ["scan_id", "event_key", "scan_completion_time", "wellness_score", "health_risk_score", "posture"]),
      vitals: pick(asRecord(event.vitals), ["heart_rate", "oxy_sat_prcnt", "resp_rate", "bp_sys", "bp_dia"]),
      metadata: pick(metadata, ["device", "fps", "heart_scores", "cardiovascular", "glucose_info", "physiological_scores", "overall_heart_score", "physiological_score", "mental_wellbeing_score"]),
    },
  };
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
