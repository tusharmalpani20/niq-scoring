/** Small support evidence only. Never copy request bodies, tokens or raw scan data. */
export function faceScanDiagnostic(stage: string, httpStatus: number | null, body: unknown, sensitiveValues: string[], failure: string) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const redact = (value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    let text = String(value);
    for (const secret of [...sensitiveValues].filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join("[redacted]");
    return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]").slice(0, 1000);
  };
  return { kind: "provider_response_diagnostic", stage, httpStatus, failure,
    receivedAt: new Date().toISOString(),
    statusCode: typeof source.statusCode === "number" ? source.statusCode : null,
    code: redact(source.code), message: redact(source.message),
    responseFields: Object.keys(source).filter(key => /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(key)).slice(0, 40),
  };
}
