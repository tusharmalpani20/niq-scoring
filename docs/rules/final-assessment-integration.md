# Final assessment integration note

This note is for the separate NIQ Application implementation. It describes the contract exposed by NIQ Scoring; it does not authorize changes in that repository.

## Current status

NIQ Scoring stores the audited profile as `formatVersion: 2`, `profile: "NIQ_FINAL_ASSESSMENT"`. The risk thresholds are visibly provisional and server-enforced as non-clinical. Admins may create/save/reopen/duplicate the draft and use internal preview. Approval, activation, new deployment assignment and public `/v1/assessments/*` binding are blocked with `PROVISIONAL_THRESHOLDS_UNCONFIRMED` or `VERSION_UNAVAILABLE` until a separately reviewed, clinically permitted package exists.

Do not silently convert the existing TEST version. The intended handoff is a new final-profile draft with its own rule-version ID, checksum and revision history.

## Consumer contract

1. Call `POST /v1/assessments/start` with an opaque `assessmentReference` after receiving a deployment credential. The response pins a concrete version and returns `questionnaire` renderer metadata. Do not send a patient identifier as the reference.
2. Render only the returned public projection. For Format 2 it contains five sections, 19 scoring fields, and supporting inputs for palliative path/timing, previous surgery count, previous/current weight and dietary intake. Points, caps, risk ranges, workbook source cells, samples and audit fields are intentionally absent.
3. Submit `POST /v1/assessments/calculate` with the same reference, a new idempotency key and answers keyed by the returned IDs. Send numeric supporting inputs as finite JSON numbers. Send explicit `[]` for an answered empty multi-select; omit or send `null` for unanswered optional inputs. Send raw weights, surgery count, palliative dependencies and dietary intake; do not submit weight-loss or protein derived answers.
4. Treat `ASSESSMENT_INCOMPLETE` as non-billable and actionable for missing data. Treat `INVALID_ASSESSMENT_ANSWERS` as a client validation error and do not retry unchanged invalid data. Successful responses include immutable version/checksum evidence and a usage-backed `resultReference`.
5. Preserve idempotency keys for retries. Repeating the same valid request replays the stored response without another usage reservation; changing answers under the same key is an `IDEMPOTENCY_CONFLICT`.

## Privacy and clinical boundary

The final scoring profile excludes patient identity, contact details, dates, reports/uploads, BMI/labs and other non-scoring workbook fields. The application should keep those concerns in its own authorized systems and must not add them to `answers`. Do not expose internal points or provisional thresholds to patients or clinicians as clinical guidance. Interventions are `N/A` and report uploads are deferred.

## Scoring invariants for client-side validation

The server is authoritative. Client validation may improve UX but must preserve these distinctions: multi-select points sum; there are no caps; explicit zero and explicit empty arrays are answers; absent/null is unanswered; palliative and derived dependencies must be present before their component is actionable; weight loss uses the unrounded percentage and the configured boundary inclusivity; previous surgery count is a positive safe integer when surgery is `Yes`; duplicate option IDs are invalid.

## Version handoff checklist

- Store the returned `ruleVersionId` and checksum with the assessment session evidence.
- Never choose a rule version from the client request.
- Never fall back from an unavailable final profile to TEST or another version without an explicit product decision.
- Keep the final-profile public integration disabled until NIQ Scoring exposes a package with `clinicalUsePermitted: true` after clinical confirmation.
