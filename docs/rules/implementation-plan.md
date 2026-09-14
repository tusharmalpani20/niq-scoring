# Rule-version management implementation plan

Branch: `feat/rule-creation-editor`. Scope: NIQ Scoring only.

## Completion checklist

- [ ] Typed format-versioned definition with reference/type/cycle validation and explicit missing-data semantics.
- [ ] Spreadsheet questionnaire template, source references, unresolved clinical questions.
- [ ] Atomic draft CRUD, normalized unique names, retry handling, revision conflicts, duplication, protected deletion.
- [ ] Accessible editor: metadata, sections/questions/options, reorder, types, validation, conditions, calculations, removal dependency warnings.
- [ ] Definition-driven preview, sample answers separate from definitions and clinical usage.
- [ ] Backend declarative scoring with boundaries, domain aggregation/caps, classification and explainable incomplete results.
- [ ] Intervention editor/evaluation with ordering, deduplication and exclusion groups.
- [ ] Saved sample cases with independent expected outputs; structural, semantic and sample validation issues linked to editor locations.
- [ ] Revision-bound validation, explicit approval, immutable published definitions, activation/retirement, actor/time audit.
- [ ] Deployment eligibility and concrete assessment-version binding; authenticated public questionnaire projection and evaluation; retained quota/idempotency safeguards.
- [ ] Automated API/domain/frontend interaction coverage, PostgreSQL checks and desktop/mobile browser flows.
- [ ] Documentation, clean committed worktree, requirement-by-requirement completion audit.

## Sequence and commit boundaries

1. Definition contracts and semantic integrity checks.
2. Source-based template and issue mapping.
3. Evaluator and sample validation (shared pure implementation; authoritative execution backend).
4. Database and draft/lifecycle APIs.
5. Editor and preview.
6. Deployment consumption and assessment binding.
7. Complete UI/API/browser/database verification and documentation.

Adjust order when contracts expose useful independent work. Each completed chunk is tested and committed. No real clinical rule is approved during development.

## Source decisions

The supplied assessment spreadsheet is the questionnaire source. The Angular reference supplies workflow ideas, not authoritative clinical rules. Its 100-point heuristic remains separate from the spreadsheet's unresolved 35-point domain model. No new clinical weights, thresholds, treatment recommendations or CarePlix-to-NIQ mappings will be invented.

Rule definitions and operational evidence belong in scoring. Patient identity, full medical records and clinician actions remain in the consuming application. Preview is non-billable and never a clinical assessment.

## Progress

- Goal objective read in full; branch and clean worktree verified.
- Existing stack includes Zod, React Hook Form, shadcn/Radix, PostgreSQL/Drizzle and Bun tests. No new runtime dependency needed for the initial definition/evaluator work.
- Earlier source review covered both source spreadsheet tabs, business requirements, all four PDF pages and reference code/handover workbooks. Preserve known discrepancies in the template.

### Draft persistence checkpoint

- Definition schema, semantic validation, source template and pure evaluator are committed (`fa2e7da`, `6d8fb5b`, `7ac34bd`).
- Draft CRUD and lifecycle APIs now use authenticated administrator identity, revision checks, canonical checksums, normalized unique names and durable creation-retry tombstones. Duplication retries remain valid after source deletion.
- Local migrations 0010 and 0011 applied after checking existing name uniqueness. Migration 0011 corrects the original unconditional immutability trigger so drafts can change while published contents remain protected. Existing provisional record retained.
- Verification: 48 API tests passed; all six workspace typechecks passed. Separately opted-in PostgreSQL test passed (11 assertions), covering concurrent creation/save, uniqueness, audit and deletion retries. Disposable rule rows removed; append-only audit evidence retained.
- Remaining: editor, public consumption/binding, broader database lifecycle/assignment checks, frontend/browser flows and final requirement audit. These backend checks do not establish end-to-end completion.

### Editor foundation checkpoint

- Rule versions now loads dedicated metadata, supports lifecycle search/filter/pagination, creation, duplication, opening and draft deletion. Creation has Details/Review steps.
- Structured editors added for sections/questions/options, validation/visibility/calculations, scoring domains/rules/classifications, and interventions. Stable IDs and reference-removal warnings are retained. Save errors preserve the local definition; reload/discard are explicit. Router supports unsaved-edit navigation blocking.
- Definition-driven preview renders all supported answer types and invokes the backend preview evaluator without usage accounting. Editing the definition clears preview answers; navigation between tabs preserves them. Results show partial values, domain/component results, classification, guidance and incompleteness reasons.
- Workspace links added for existing contracts and answer-validation modules; no new external packages. Source clinical decisions remain unresolved and editable only as draft review evidence.
- Verification: 18 frontend tests (74 assertions; validation/helpers, not complete interaction coverage), workspace typechecks and production build passed. Browser inspected the live list and creation dialog in an isolated tab, then closed that tab. No synthetic record created by this browser check.
- Remaining: sample-case authoring, useful validation issue navigation, broader editor interaction and responsive tests, end-to-end browser workflow, deployment consumption/binding, and final audit. Build reports a large main bundle; consider loading the editor separately during final optimization.

### Sample authoring checkpoint

- Added structured sample cases in Validation with questionnaire answers, expected completion/total/classification/guidance, and optional domain/calculation expectations. Blank numeric expectations mean no assertion; zero remains explicit.
- Preview answers can be deliberately copied into a sample. Expectations are not copied from actual evaluator output. Shared questionnaire controls keep sample entry and preview consistent.
- Validation mismatch messages now include independently expected and actual values. Issue links select the relevant editor tab, open the question/sample when needed, and focus its controls.
- Late preview responses are ignored if the definition/answers/revision changed while evaluation was running.
- Verification: 24 targeted API/evaluator/frontend helper tests passed (161 assertions before the additional expected/actual message assertion); evaluator test rerun passed with that assertion. All workspace typechecks and admin production build passed. No new browser interaction coverage in this checkpoint.
- Remaining: complete browser and frontend interaction coverage, deployment binding/consumption integration, database lifecycle/authorization checks, source review controls and final end-to-end audit. Goal remains active.

### Deployment consumption checkpoint

- Added authenticated start/calculate assessment APIs and persisted concrete version bindings, with deterministic latest-approved resolution, eligible pins, retained retired bindings and public questionnaire allowlisting.
- Added request fingerprints across assessment/provisional/face-scan requests; scope/capability disabling precedes replay and quota reservations retain concrete rule IDs. Bindings protect related records from deletion. No answers stored in bindings.
- Moved template internal scoring help to source notes and displayed those notes in questionnaire provenance. No clinical content invented.
- Migration 0012 applied locally. Both PostgreSQL integration tests passed (23 assertions), including rollback-only binding/retirement/quota/replay checks. Full workspace tests and typechecks passed; API suite now 53 passed, 2 opt-in database skips in ordinary run.
- Remaining: comprehensive frontend interaction tests and desktop/mobile browser workflows, performance/readability review, adversarial validation/permission audit, documentation reconciliation and final requirement-by-requirement completion proof. No completion claim yet.

### Intervention exclusion audit

- Corrected evaluation of exclusive guidance: a selected higher-priority recommendation now skips lower-priority alternatives before evaluating their answer requirements. Unknown higher-priority or independent guidance still prevents a complete result.
- Added a synthetic regression covering definition order, selected alternatives, unanswered fallback, independent guidance and unresolved higher-priority winners. Documented the semantics in `definition-format.md`.
- Verification: all 10 targeted evaluator tests passed (52 assertions); workspace tests and all six typechecks passed. The two opt-in PostgreSQL tests were skipped in this ordinary test run; no new browser coverage claimed.
- Full interaction/browser verification and the final completion audit remain outstanding. Goal stays active.
