# Version-bound assessment consumption

These endpoints authenticate with the existing deployment credential (`Authorization: Bearer …`). The credential determines client and deployment; callers cannot supply another client or arbitrary rule-version ID. Responses use `Cache-Control: no-store`.

## Start or resume

POST `/v1/assessments/start`

```json
{"assessmentReference":"opaque-assessment-reference"}
```

Use an opaque reference of 1–128 characters, without patient identity. The first request persists a binding to the deployment's pinned eligible version or latest eligible approved version. Latest resolution orders by approval time then version ID. Retrying the same deployment/reference returns the same binding. Start does not consume quota.

The response includes `bindingId`, `assessmentReference`, `ruleVersionId`, `checksum`, `version`, and `questionnaire`. The questionnaire is an explicit allowlist of sections, questions, options, constraints, units, help and visibility conditions. Internal points, classification/intervention authoring, samples, provenance and audit data are excluded. Spreadsheet scoring hints are retained internally in source notes, not public help.

Existing bindings remain tied to their original version when an administrator changes the assignment. Ordinary retirement prevents new bindings to that version but allows existing bindings to finish. The version/checksum must still match the retained immutable package.

## Calculate

POST `/v1/assessments/calculate`

```json
{
  "assessmentReference":"opaque-assessment-reference",
  "idempotencyKey":"unique-calculation-request",
  "answers":{"question_id":0}
}
```

Start must have established the binding first; otherwise the API returns `ASSESSMENT_NOT_FOUND` (404). Invalid request shapes return 400. Missing/invalid assessment data returns `ASSESSMENT_INCOMPLETE` (422) with explanations and partial results, without billing. No raw answers are persisted in assessment bindings or usage rows.

Successful responses contain `result` and `idempotencyKey`. Result evidence includes the concrete rule ID, checksum, binding/reference, calculation timestamp and usage-backed `resultReference`, as well as calculations, component/domain scores, total, classification and guidance.

Real successful evaluation consumes the existing SCORING entitlement. The reservation lock, monthly PostgreSQL counter and pending usage treatment are preserved. Repeating an identical completed request returns its original response without another charge. A changed payload/binding under the same key returns `IDEMPOTENCY_CONFLICT`. Provisional and rule-based scoring use different request fingerprints, preventing cross-endpoint replay. Historical usage without a fingerprint cannot be safely matched to a newly fingerprinted request and conflicts; its stored evidence is preserved.

Client, deployment, platform and scoring-capability disabling prevent retrieval and calculation, including response replay. Re-enabling restores access subject to entitlements and version availability. A full quota does not prevent retrieving the bound questionnaire or replaying an already completed identical result.

## Persistence and retention

`assessment_bindings` stores client/deployment ownership, opaque reference, concrete rule ID, checksum and creation time. It stores no questionnaire answers. A unique deployment/reference constraint and assignment advisory lock serialize resolution. Rule row locks synchronize selection with lifecycle mutations. Foreign keys protect bound rules and owning records from deletion.

Usage rows now store request fingerprints and the concrete scoring-rule ID. The existing response retention policy continues to apply; result breakdowns are retained for idempotent responses. Deployment and rule deletion checks include bindings.

Draft versions cannot be newly pinned. Existing retired pins may be retained while editing unrelated settings, but cannot start new assessments. The provisional scorer remains a separate non-production endpoint; its historical assignment is preserved.

## Verification

API tests cover concrete/latest binding, public projection, retirement, no arbitrary version selection, missing inputs, disabling, retry fingerprints and quota behavior. Run the database integration tests explicitly from `apps/api`:

```sh
RULE_DATABASE_TEST=1 bun --env-file=../../.env test src/postgres-assessment-binding.test.ts src/postgres-rule-store.test.ts
```

The binding test uses a rollback-only synthetic transaction. The CRUD test removes its synthetic drafts and retains append-only audit evidence. These do not replace the full editor/browser review.
