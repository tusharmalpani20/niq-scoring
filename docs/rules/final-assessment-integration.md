# Final assessment integration note

This note is for the separate NIQ Application implementation. It describes the contract exposed by NIQ Scoring; it does not authorize changes in that repository.

## Current status

NIQ Scoring stores the profile as `formatVersion: 2`, `profile: "NIQ_FINAL_ASSESSMENT"`. New drafts use client-confirmed defaults. Confirmed definitions still require normal validation and approval before deployment assignment or public evaluation. Existing development definitions retain their original thresholds and restrictions until explicitly upgraded and saved with revision checking. The admin editor provides **Apply confirmed rules** for eligible drafts; it changes weight-loss thresholds and risk categories while preserving configured points and does not alter approved history.

Do not silently convert the existing TEST version. The intended handoff is a new final-profile draft with its own rule-version ID, checksum and revision history.

## Consumer contract

1. Call `POST /v1/assessments/start` with an opaque `assessmentReference` after receiving a deployment credential. The response pins a concrete version and returns `questionnaire` renderer metadata. Do not send a patient identifier as the reference.
2. Render only the returned public projection. For Format 2 it contains five sections, 19 scoring fields, and supporting inputs for palliative path/timing, previous surgery count, previous/current weight and dietary intake. Points, caps, risk ranges, workbook source cells, samples and audit fields are intentionally absent.
3. Submit `POST /v1/assessments/calculate` with the same reference, a new idempotency key and answers keyed by the returned IDs. Send numeric supporting inputs as finite JSON numbers. Send explicit `[]` for an answered empty multi-select; omit or send `null` for unanswered optional inputs. Send raw weights, surgery count, palliative dependencies and dietary intake; do not submit weight-loss or protein derived answers.
4. Treat `ASSESSMENT_INCOMPLETE` as non-billable and actionable for missing data. Treat `INVALID_ASSESSMENT_ANSWERS` as a client validation error and do not retry unchanged invalid data. Successful responses include immutable version/checksum evidence and a usage-backed `resultReference`.
5. Preserve idempotency keys for retries. Repeating the same valid request replays the stored response without another usage reservation; changing answers under the same key is an `IDEMPOTENCY_CONFLICT`.

## Privacy and clinical boundary

The final scoring profile excludes patient identity, contact details, dates, reports/uploads, BMI/labs and other non-scoring workbook fields. The application should keep those concerns in its own authorized systems and must not add them to `answers`. Do not expose internal rule configuration through the public questionnaire projection. Interventions are `N/A`. Additional report uploads belong to NIQ Application and are outside this scoring implementation.

## Scoring invariants for client-side validation

The server is authoritative. Client validation may improve UX but must preserve these distinctions: multi-select points sum; there are no caps; explicit zero and explicit empty arrays are answers; absent/null is unanswered; palliative and derived dependencies must be present before their component is actionable; weight loss uses the unrounded percentage and the configured boundary inclusivity; previous surgery count is a positive safe integer when surgery is `Yes`; duplicate option IDs are invalid.

## Version handoff checklist

- Store the returned `ruleVersionId` and checksum with the assessment session evidence.
- Never choose a rule version from the client request.
- Never fall back from an unavailable final profile to TEST or another version without an explicit product decision.
- Use only an approved, available rule package selected by the server. Source confirmation alone does not approve a draft.


## Confirmed assessment defaults

Positive weight loss below 6% gives 1 point; 6–10% inclusive gives 2; above 10% gives 3. Gain/no change gives 0. Calculate from positive previous/current weights before display rounding. Each supplied weight is validated independently even when the other is absent.

Normal intake and More than usual map to Adequate (0); the other four intake choices map to Inadequate (1). Assessment point settings and surgery rates are whole numbers. Risk defaults are Low Risk 0–15, Moderate Risk 16–25, High Risk above 25. All multi-select contributions add without caps.

## Independent face-scan points

`@niq-scoring/scoring-engine/face-scan-scoring` exports `calculateFaceScanScore({ wellnessScore }, definition.faceScanScoring, ruleVersionId)`. The provider's `wellness_score` (Overall Health Score) must be normalized to this numeric 0–100 input by the future trusted provider adapter. Do not substitute `health_risk_score`, individual vitals or an assessment total.

- Below 70% → 3 points.
- 70–80%, inclusive → 2 points.
- Above 80% → 1 point.

The result includes `ruleVersionId`, an exact `configuration` snapshot, `wellnessScore`, `points` and `status`. `scoringVersion` is `NIQ_FACE_SCAN_2026_09` only for the original mapping and null for custom mappings. Missing/null returns `UNAVAILABLE` with null points; invalid numbers/types are rejected. A real zero score is valid and returns 3 points. No rounding occurs before classification. This result is independent of assessment totals and categories.

The Face scan editor stores `faceScanScoring` in each rule definition: `lowerThreshold`, `upperThreshold`, `belowPoints`, `middlePoints`, and `abovePoints`. Thresholds are percentages from 0–100 with the lower strictly below the upper; points are nonnegative safe integers. The middle range includes both thresholds. Historical definitions may omit this property and retain the defaults above without rewriting historical JSON or checksums. New templates include it explicitly. The trusted integration must resolve the selected persisted rule version and pass its configuration and ID to the evaluator; never accept caller-selected settings. This phase adds the calculation and tests only; it does not enable camera capture, authenticate CarePlix, create provider sessions, process callbacks or charge usage. No new public endpoint accepts unverified face-scan claims. Live integration will connect trusted provider results to this evaluator separately.

Server-only `CAREPLIX_API_BASE_URL`, `CAREPLIX_API_KEY` and `CAREPLIX_API_SECRET` are documented in `.env.example`; local values remain outside Git. Authentication is still awaiting provider clarification. Do not expose these values to the browser.
