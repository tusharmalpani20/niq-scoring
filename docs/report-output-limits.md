# Report model output limits

OpenRouter's output allowance includes internal reasoning and visible JSON. A
strict JSON schema does not make an output cut off by the provider safe to use.
All seven report roles now have explicit budgets:

| Role | Initial output allowance | Maximum per request |
| --- | ---: | ---: |
| Manager | 8,000 | 32,000 |
| Writer | 8,000 | 32,000 |
| Revision | 8,000 | 32,000 |
| Reviewer | 6,000 | 24,000 |
| Coverage | 8,000 | 32,000 |
| Summarizer | 8,000 | 32,000 |
| Highlighter | 4,000 | 16,000 |

These are engineering allowances, not required response lengths or guarantees
that every schema-permitted workload will fit. The manager can return many source
assignments, writer/revision return evidence-linked narrative fields, coverage
returns source-specific gaps, summarizer returns complete intervention cards,
and highlighter handles up to four sections per request. Larger demonstrated
workloads may need batching rather than continually increasing the ceiling.

The model assignments, medium reasoning, clinical schemas, review requirements,
Azure-only routing and privacy settings are unchanged. Codex proxy was also
reviewed: it does not impose an explicit output-token cap and already rejects
incomplete Responses events. Its inference/admission behavior is unchanged.

## Bounded retries

- A stage makes at most three actual OpenRouter requests, each with the existing
  120-second timeout. Unsupported-reasoning fallback counts within these three.
- `finish_reason: length` becomes `MODEL_OUTPUT_LIMIT`, even when the returned
  text happens to parse as JSON. It is never accepted as a clinical decision.
- Only output-limit failures double the next request's allowance, up to the
  role's ceiling. These retries stay inside the same stage, retaining its draft,
  prompts and schema rather than replaying preceding agents.
- Other transient/invalid-response retries retain the allowance. Payment,
  provider mismatch, content filtering, refusal and non-retryable request
  failures stop immediately. Refusal text is never copied into diagnostics.
- HTTP 200 error envelopes use the same safe classification as HTTP errors,
  including numeric/string payment, authentication and rate-limit codes. Usage
  is extracted from unsuccessful HTTP replies too, when the provider supplies it.
- If reviewer retries still fail, the run remains held. Durable job status
  exposes the precise safe `MODEL_*` cause instead of the generic automatic
  clinical recovery failure. No review is bypassed and no PDF is published.

## Attempt accounting

Usage is extracted before parsing the model's JSON. Each completed upstream
attempt records its usage, generation ID, status and error in the existing run
call table. A `provider_attempt` trace event adds stage sequence, attempt number,
output allowance and an allowlisted finish reason. The stage trace contains the
attempt list too. Stage completion does not insert a duplicate usage row.

Attempt metadata must persist before another provider request. Before each
OpenRouter request, the worker also checks/renews the durable run and job leases;
ownership lost between attempts stops the next request before inference.
Trace/lease failures stop inference. The original stage request is still traced before its
first request; a process crash during a request can leave that stage pending,
with no provider usage yet available. Unknown usage remains null, not zero.

No migration is needed: safe metadata uses existing call columns and trace JSON.
No raw malformed completion, hidden reasoning, refusal text or provider error
body is added to operational logs. Existing diagnostic access and 30-day trace
retention apply. Regular usage lists now count actual provider attempts, rather
than hiding multiple requests behind one agent stage.

This change does not reopen old terminal jobs, regenerate assessments or add
cross-run checkpoint recovery. Existing failed drafts remain in their original
protected traces/run response. Recovering an old run is a separate operation.

Official background: [OpenRouter reasoning and output budgets](https://github.com/OpenRouterTeam/docs/blob/main/guides/best-practices/reasoning-tokens.mdx#reasoning-tokens-and-max_tokens).
