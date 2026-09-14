# Rule draft management API

All `/admin/rules` operations require an enabled administrator session. Mutations also require an allowed Origin. Definitions use format version 1; legacy packages can be read but cannot be edited, duplicated, previewed or transitioned through this API.

| Method and path | Request | Result |
| --- | --- | --- |
| GET `/admin/rules` | — | Metadata list, including revision and editability |
| POST `/admin/rules` | `name`, UUID `requestId`, optional `template` (`spreadsheet` only), optional `duplicateId` | Created draft |
| GET `/admin/rules/:id` | — | Definition, metadata and audit events |
| PUT `/admin/rules/:id` | Current `revision`, complete `definition` | Saved draft with incremented revision |
| POST `/admin/rules/:id/preview` | Current `revision`, `answers` | Non-billable evaluation with version/checksum evidence |
| POST `/admin/rules/:id/check` | Current `revision` | Semantic and sample validation issues |
| POST `/admin/rules/:id/validate` | Current `revision` | VALIDATED after semantic and sample checks |
| POST `/admin/rules/:id/approve` | Current `revision` | Explicit approval of validated content |
| POST `/admin/rules/:id/activate` | Current `revision` | ACTIVE from APPROVED |
| POST `/admin/rules/:id/retire` | Current `revision` | RETIRED from APPROVED or ACTIVE |
| DELETE `/admin/rules/:id` | Current `revision` | Deletes an unreferenced DRAFT |

Names are trimmed and compared case-insensitively. Names must contain 1–80 characters. Database uniqueness protects concurrent writes. Content IDs remain unchanged when duplicating a package; the new package has its own identity and revision history.

Creation requests carry a UUID generated once per logical creation attempt. Repeating the same request returns its existing draft; changing its payload or actor conflicts. Deleting the created draft leaves a durable audit tombstone, so a retry cannot resurrect it. Retry resolution precedes reading a duplication source, which may no longer exist.

Saves atomically replace the definition and increment the revision. A stale revision returns `RULE_REVISION_CONFLICT` (409); the editor must preserve its unsaved contents. Repeating a save after a lost response returns a conflict, allowing the caller to reload and compare rather than silently overwrite changes.

DRAFT and VALIDATED contents matching the fixed Excel profile are configurable; saving resets lifecycle to DRAFT and removes validation evidence. Every lifecycle transition increments the operational revision while retaining checksum-bound evidence for unchanged content. APPROVED, ACTIVE and RETIRED contents are immutable. Transitioning back to draft is forbidden. Duplicate to make corrections.

Semantic errors prevent saving; incomplete clinical mappings may remain in drafts as blocking issues. Validation and approval require no outstanding issues and successful independently specified sample expectations. Technical validation does not perform clinical approval.

Audit records retain actor, time, action, revision and checksum. Definition writes and audit events commit together. Deletion checks deployment-assignment history and historical usage; foreign keys prevent concurrent references being erased. Assessment bindings also prevent deletion.

## Database verification

From `apps/api`, explicitly opt in against the configured local migrated database:

```sh
RULE_DATABASE_TEST=1 bun --env-file=../../.env test src/postgres-rule-store.test.ts
```

The test requires an existing enabled administrator, creates only uniquely identified synthetic drafts, and removes those rule rows afterward. Append-only audit evidence remains. Normal `bun test` skips this database test; run it separately when verifying persistence changes.

## Sample authoring workflow

In the editor's Validation tab, add a sample case, enter synthetic questionnaire answers, and independently specify its expected completion, total, classification and guidance. Optional domain/calculation entries assert only explicitly populated values. A zero is checked; a blank skips that optional assertion.

The Preview tab can copy entered answers into a new sample, but deliberately leaves expectations empty. Saving these changes invalidates earlier validation like any other definition change. Run definition/sample checks after saving. Mismatch messages show expected and actual values; issue links navigate to the affected question, rule, source decision or sample.

Preview answers are transient. Tab navigation retains them; changing the definition clears them. Responses from evaluations started before a definition or answer change are discarded to avoid showing stale results.

## Fixed Excel authoring (current workflow)

New versions always start from the latest NIQ Excel profile. `template` may be omitted or set to `spreadsheet`; `blank` is rejected. Administrators cannot add, remove, reorder or change questions, field types, answer options, visibility, calculation formulas, domain identities or scoring-component references. The API verifies those constraints independently of the UI and returns `409 FIXED_RULE_REQUIRED` for structural changes or attempts to edit/duplicate an earlier custom profile.

Points, option aggregation, domain assignments, applicable range thresholds, component/domain/total caps, classification configuration, interventions, evidence and samples remain versioned. The complete stored definition is retained for historical reproducibility. Existing approved definitions and bound assessments are not rewritten. Older custom definitions are read-only in the editor; create a new Excel version instead.

The Excel master sheet supplies five domain caps (Disease 5, Clinical 10, History 5, Treatment 5, Nutrition 10), total cap 35 and GI symptom cap 6. It is authoritative over the earlier 100-point demo. Explicit source points are prefilled; no value is substituted for a missing point. An unmapped option appears blank and can be scored explicitly.

The workbook does not provide question-to-domain assignments. `unassigned` is a technical draft placeholder, excluded from clinical totals when empty and hidden from domain-cap controls. Every remaining unassigned component independently blocks validation, even if a source-decision note is marked resolved. Choose one of the five Excel domains for each component.

Incomplete source content remains documented in the version's Source decisions: palliative time-window rules; lab units and boundaries; symptom overlap; required/none-answer policies; therapy aggregation; weight-loss baseline; intervention triggers. Where executable rules are not justified (such as overlapping haemoglobin bands), they are not invented. Such content needs a reviewed update to the fixed profile. Merely resolving a note is not implementation of a missing algorithm.

## Scoring page

The administration UI opens each version at `/versions/:id`, including after creation. The list has an edit icon for editable versions. URLs support direct opening and refresh; leaving unsaved changes requires discard confirmation.

The page uses underlined Details, Scoring and Interventions tabs, with Scoring selected initially. One Scoring table replaces the separate questionnaire and scoring views: Field name, Type, Score and Cap. Fixed fields and calculated values are listed together; score summaries open inline controls. Selection fields show configured option counts, numeric scoring shows range counts, and unscored fields distinguish Not applicable from Not configured. Scoring bands can be added or removed without changing the underlying input field. Domain/total caps and risk categories are compact expandable sections.

Interventions displays N/A because its design is not finalized. The UI no longer offers Preview, Validation, source-decision editing, sample authoring or lifecycle approval controls. Saving still enforces schema and reference checks on the client and server; incomplete rules remain drafts and do not gain clinical eligibility. Existing API validation/approval enforcement and historical assessment evaluation are retained. UI simplification does not automatically approve versions or erase historical interventions.
