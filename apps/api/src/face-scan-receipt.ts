/** Retain complete result evidence, including unknown fields, without credentials or camera input echoes. */
export function allowlistedFaceScanReceipt(body: object, secrets: string[] = []): unknown {
  const clean = (value: unknown, depth = 0): unknown => {
    if (depth > 64) return "[unsupported nesting]";
    if (Array.isArray(value)) return value.map(entry => clean(entry, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/api.?key|secret|token|authorization|password|raw_intensity|ppg_time|screenshot|video|image/i.test(key))
      .map(([key, entry]) => [key, clean(entry, depth + 1)]));
    if (typeof value === "string") return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join("[redacted]"), value);
    return value;
  };
  return clean(body);
}
