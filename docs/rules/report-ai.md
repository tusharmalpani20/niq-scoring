# Report text generation in Scoring

NIQ Scoring owns rule matching and report text generation. NIQ Application sends a
pseudonymous, structured fact packet after final clinical approval and uses the
returned text in the automatically generated PDF. Scoring does not accept names, raw documents, face images,
or free-form clinical notes at this endpoint.

## Configuration and deployment

- A rule version may contain `reportAi`: `enabled`, `model`, `writerPrompt`, and
  `reviewerPrompt`. The only allowed model is `openai/gpt-6-luna`.
- The editable prompts are user-role content. Fixed safety and evidence rules are
  server-owned system-role content. Editing an active rule is prohibited by the
  existing rule lifecycle; copy it to a draft to change prompts.
- Older active versions without `reportAi` use the fixed `baseline-v1` prompt
  configuration. The response and usage log identify this fallback.
- Apply the Scoring migrations, including `0028_report_content_jobs`. Set
  `OPENROUTER_API_KEY` and `REPORT_AI_PROVIDER_ENABLED=true` when provider calls
  are ready to resume. The provider is disabled by default; the key is never
  returned to Application or the admin UI.
- OpenRouter requests require Azure routing, zero data retention, denied provider
  data collection, and no provider fallback. A response that explicitly identifies
  another provider is rejected. If OpenRouter has no Azure zero-retention endpoint
  for this model, generation fails closed. Verify this with the deployment's actual
  OpenRouter account before clinical use.

## API

Application uses `POST /v1/assessments/report-content/jobs` to submit a durable
job and `GET /v1/assessments/report-content/jobs/:runId` to read its status and
completed response. Both require the deployment bearer credential. Repeating a
submission with the same idempotency key and facts returns the same job. The
older synchronous `POST /v1/assessments/report-content` remains available.

The submission
It accepts the pinned assessment reference, a completed Scoring result reference,
an idempotency key, and reviewed structured facts with the completed assessment
date. The reviewed score must equal
the referenced Scoring result. Risk, treatment, drug class, co-morbidity, toxicity,
and observation IDs are checked against the pinned rule and allowlists.

Application is the trusted source for the remaining clinical facts in this release.
It derives them from the completed submission and reviewed score, then sends only
the allowlisted fields. Scoring does not retain a second assessment-answer snapshot
and therefore cannot independently compare those facts with the original answers.
Any other integration using a deployment credential must uphold the same boundary.

Scoring resolves only matched guidance. The response contains nine narrative
fields with evidence IDs, resolved guidance, result and rule provenance, model,
prompt/schema versions, run ID, status, and issue codes. Possible treatment
toxicities carry conditional nutrition guidance and remain separate from confirmed
toxicity interventions. Source wording that names an individual drug is withheld
when only a class is known. The response
does not contain the full rule definition, editable prompts, or source tables.
When no single Products & doses rule is selected, Scoring omits the product plan
and product exception wording from the report packet. Other matched sections can
still be generated.

The report coordinator holds the pinned matched evidence and decides whether a
draft can issue. It calls specialized writer, reviewer, coverage, intervention
summary, and highlighter workers. The writer can repair passages after reviewer
or coverage findings. Local schema and evidence checks are independent of the
model reviewer. Coverage checks matched nutrition, treatment-status, drug-class,
treatment, and product-exception guidance, preserving distinct source meaning,
possible-effect summaries must pass their own audit, and highlighting may only
mark exact phrases from approved text. The coordinator makes the final `READY`
or `REVIEW_REQUIRED` decision; workers cannot approve their own output.

These are distinct role-specific model calls inside one durable Scoring job, not
separately queued services. The job store persists input, status, lease, attempts,
and the final response; the generation store records each worker call and fences
late attempts. Active model work renews both attempt-fenced leases each minute.
If either renewal fails, that attempt stops before another model step or final
approval. If the provider is disabled, fails, or its output needs review,
the coordinator tries a deterministic fallback from pinned matched rules. The
fallback issues `READY` only when its source and coverage checks pass; conflicting
or incomplete rules fail rather than producing unsupported patient advice.
Application stores the PDF after final clinical approval of the assessment.
There is no separate manual report approval in this workflow.

`GET /admin/report-ai/models` lists the allowed model. `GET /admin/report-ai/runs`
supports `page`, `pageSize`, and optional `clientId`. It returns run status and
per-call provider, token, cost, latency, and error metadata. It omits patient
references, prompts, evidence, generated text, and raw provider responses.
