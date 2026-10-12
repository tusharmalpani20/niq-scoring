# Report text generation in Scoring

NIQ Scoring owns rule matching and report text generation. NIQ Application sends a
pseudonymous, structured fact packet and uses the returned text in its clinical
review and PDF workflow. Scoring does not accept names, raw documents, face images,
or free-form clinical notes at this endpoint.

## Configuration and deployment

- A rule version may contain `reportAi`: `enabled`, `model`, `writerPrompt`, and
  `reviewerPrompt`. The only allowed model is `openai/gpt-6-luna`.
- The editable prompts are user-role content. Fixed safety and evidence rules are
  server-owned system-role content. Editing an active rule is prohibited by the
  existing rule lifecycle; copy it to a draft to change prompts.
- Older active versions without `reportAi` use the fixed `baseline-v1` prompt
  configuration. The response and usage log identify this fallback.
- Set `OPENROUTER_API_KEY` on the Scoring server and apply migration `0023`.
  The key is never returned to Application or the admin UI.
- OpenRouter requests require Azure routing, zero data retention, denied provider
  data collection, and no provider fallback. A response that explicitly identifies
  another provider is rejected. If OpenRouter has no Azure zero-retention endpoint
  for this model, generation fails closed. Verify this with the deployment's actual
  OpenRouter account before clinical use.

## API

`POST /v1/assessments/report-content` requires the deployment bearer credential.
It accepts the pinned assessment reference, a completed Scoring result reference,
an idempotency key, and reviewed structured facts with the completed assessment
date. The reviewed score must equal
the referenced Scoring result. Risk, treatment, drug class, co-morbidity, toxicity,
and observation IDs are checked against the pinned rule and allowlists.

Scoring resolves only matched guidance. The response contains four short narrative
fields with evidence IDs, resolved guidance, result and rule provenance, model,
prompt/schema versions, run ID, status, and issue codes. Possible treatment
toxicities carry conditional nutrition guidance and remain separate from confirmed
toxicity interventions. Source wording that names an individual drug is withheld
when only a class is known. The response
does not contain the full rule definition, editable prompts, or source tables.

The server runs one writer call, one reviewer call, and at most one targeted writer
revision. A revised draft receives a second reviewer call. Local schema and
evidence checks run independently of the model reviewer. Reviewer issues receive
at most one targeted revision. If issues remain, the affected passage is omitted
while supported passages can still produce a `READY` result. A failed provider call
cannot produce a `READY` result. The clinician still
reviews and approves the final report in Application.

The workflow is an explicit bounded function rather than a LangGraph dependency:
the stages, retries, and durability are limited and visible in the Scoring store.
Provider retries occur only for transient failures. An orchestration library can be
introduced when the workflow actually needs branching or long-running resumptions.

`GET /admin/report-ai/models` lists the allowed model. `GET /admin/report-ai/runs`
supports `page`, `pageSize`, and optional `clientId`. It returns run status and
per-call provider, token, cost, latency, and error metadata. It omits patient
references, prompts, evidence, generated text, and raw provider responses.
