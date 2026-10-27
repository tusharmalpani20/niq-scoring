const failureCodes = new Set([
  "MODEL_CONTENT_FILTER",
  "MODEL_CONTEXT_LIMIT",
  "MODEL_INVALID_JSON",
  "MODEL_INVALID_PARAMETERS",
  "MODEL_INVALID_RESPONSE",
  "MODEL_OUTPUT_LIMIT",
  "MODEL_PAYMENT_REQUIRED",
  "MODEL_PROVIDER_MISMATCH",
  "MODEL_RATE_LIMITED",
  "MODEL_REASONING_UNSUPPORTED",
  "MODEL_REFUSAL",
  "MODEL_TIMEOUT",
  "MODEL_UNAVAILABLE",
  "FALLBACK_CONTENT_TOO_LARGE",
  "FALLBACK_SOURCE_CONFLICT",
  "FALLBACK_SOURCE_INCOMPLETE",
  "REPORT_TRACE_UNAVAILABLE",
  "REPORT_TRACE_DUPLICATE_SEQUENCE",
  "PDF_RENDER_FAILED",
  "AUTOMATIC_RETRIES_EXHAUSTED"
]);
export function monitoringFailureCode(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && failureCodes.has(code) ? code : undefined;
}

/** Strict allowlist: clinical data, error messages, requests and breadcrumbs never leave the app. */
const operations = new Set([
  "api_request", "browser_error", "push_delivery", "face_scan_recovery", "report_worker",
  "report_generation", "pdf_render", "report_retry_exhausted", "source_validation", "trace_storage",
]);
export function sanitizeMonitoringEvent<T>(input: T): T {
  const event = input as Record<string, any>;
  const operation = operations.has(event.tags?.operation) ? event.tags.operation : "unexpected_error";
  const values = Array.isArray(event.exception?.values) ? event.exception.values.slice(-1).map((exception: any) => ({
    type: "Error", value: `NIQ ${operation.replaceAll("_", " ")}`,
    ...(exception.mechanism ? { mechanism: { type: "generic", handled: exception.mechanism.handled !== false } } : {}),
    stacktrace: { frames: (exception.stacktrace?.frames ?? []).slice(-40).map((frame: any) => {
      const filename = typeof frame.filename === "string" ? frame.filename.split(/[?#]/)[0].split(/[\\/]/).pop() : undefined;
      return {
        ...(filename && /^[a-zA-Z0-9_.-]+\.(?:[cm]?js|tsx?)$/.test(filename) ? { filename } : {}),
        ...(Number.isSafeInteger(frame.lineno) ? { lineno: frame.lineno } : {}),
        ...(Number.isSafeInteger(frame.colno) ? { colno: frame.colno } : {}),
        ...(typeof frame.in_app === "boolean" ? { in_app: frame.in_app } : {}),
      };
    }) },
  })) : [{ type: "Error", value: `NIQ ${operation.replaceAll("_", " ")}` }];
  return {
    ...(typeof event.event_id === "string" && /^[a-f0-9]{32}$/.test(event.event_id) ? { event_id: event.event_id } : {}),
    ...(typeof event.timestamp === "number" ? { timestamp: event.timestamp } : {}),
    platform: "javascript", level: event.level === "fatal" ? "fatal" : "error",
    ...(typeof event.environment === "string" && /^[a-zA-Z0-9._-]{1,40}$/.test(event.environment) ? { environment: event.environment } : {}),
    ...(typeof event.release === "string" && /^[a-zA-Z0-9._@+-]{1,100}$/.test(event.release) ? { release: event.release } : {}),
    tags: { operation, ...(failureCodes.has(event.tags?.failure_code) ? { failure_code: event.tags.failure_code } : {}) }, fingerprint: ["{{ default }}", operation], exception: { values },
  } as T;
}
