# Rule draft management API

All `/admin/rules` operations require an enabled administrator session. Mutations also require an allowed Origin. Definitions use format version 1; legacy packages can be read but cannot be edited, duplicated, previewed or transitioned through this API.

| Method and path | Request | Result |
| --- | --- | --- |
| GET `/admin/rules` | — | Metadata list, including revision and editability |
| POST `/admin/rules` | `name`, UUID `requestId`, optional `template` (`blank` or `spreadsheet`), optional `duplicateId` | Created draft |
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

DRAFT and VALIDATED contents are editable; saving resets lifecycle to DRAFT and removes validation evidence. Every lifecycle transition increments the operational revision while retaining checksum-bound evidence for unchanged content. APPROVED, ACTIVE and RETIRED contents are immutable. Transitioning back to draft is forbidden. Duplicate to make corrections.

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
