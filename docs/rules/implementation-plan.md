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

### Repeatable frontend browser coverage

- Added development-only `@playwright/test` and a dedicated port-4183 test server. All API requests are intercepted with synthetic data; no real sessions, database records or clinical approvals are used. Setup and scope are documented in `browser-testing.md`.
- Six Chromium runs now pass: desktop and mobile-sized coverage for creation retries/request identity, revision-conflict edit preservation, discard/keep-editing, save/reopen, adding sections/questions/options, option reordering with stable IDs, and definition-driven preview answer retention across tabs.
- The mobile test exposed an unreachable Details tab after navigating to Preview. Rule editor tabs now wrap and align to the start, keeping all sections reachable on narrow screens. The failing interaction passes after that fix.
- Workspace unit tests and typechecks passed; browser test/config files are now included in frontend typechecking. This is controlled-API frontend coverage, not full-stack browser proof. Remaining scenarios include conditional-field interactions, reference-removal warnings, scoring/intervention/sample authoring, lifecycle actions, and full-stack review.

### Conditional authoring browser checkpoint

- Added desktop and mobile interaction coverage for configuring a boolean visibility condition, explicit yes/no preview behavior, missing comparison validation, and reference-removal warnings. The test checks both keeping a referenced field and deliberately removing it, then proves the invalid definition cannot overwrite the saved draft.
- Reproduced and fixed a bug where clearing a boolean comparison selected `false`. The unset choice now remains unset, and saving requires an explicit comparison value.
- All eight browser runs pass. Scoring/intervention/sample authoring, lifecycle interactions, full-stack browser review and final completion audit remain outstanding.

### Scoring and sample interaction checkpoint

- Added desktop/mobile authoring coverage for option points (including explicit zero), domain/total caps, protected referenced-domain removal, classifications, intervention conditions/type/priority, and independent complete sample expectations.
- Browser checks exercise failing sample validation, expected-versus-actual messages, issue-link focus, correction and validation, approval cancellation/confirmation, and read-only controls after approval.
- Shared test fixtures use the real pure validators for check results and controlled lifecycle responses for frontend state. They do not prove database lifecycle enforcement; backend and PostgreSQL tests cover that separately.
- All ten browser runs and frontend typechecking passed. No production data changed. Remaining verification includes range/calculation editing, activation/retirement and duplication/deletion flows, full-stack browser review, further semantic validation audit and the final requirement-by-requirement audit.

### Calculation and saved-state checkpoint

- Added desktop/mobile calculation operand editing, range boundaries, zero/missing-input preview behavior, and activation/retirement confirmation coverage. Preview responses in these tests use the pure evaluator with independent expected totals.
- The new range test reproduced a false unsaved-state bug after successful saving: schema parsing changed JSON property order, which was compared directly with the raw response. Saved definitions are now normalized through the same schema before comparison. Preview and lifecycle actions no longer remain disabled solely because property order differs.
- All twelve browser runs pass. Duplication/deletion flows, full-stack browser review, semantic validation audit and final completion proof remain outstanding.

### Real API browser checkpoint

- Added a separately invoked browser integration suite with no API interception. A gated loopback fixture starts real Hono/authentication/rule routes with disposable memory stores; it never connects to the user database or changes the normal Vite/API endpoints.
- Both desktop and mobile runs pass for login, source-template draft creation, save/reopen after page reload, blocked validation of unresolved source content, duplication with independent edits and confirmed unused-draft deletion.
- This establishes browser-to-real-API behavior with memory persistence. It does not establish PostgreSQL behavior or persistence after a server restart. Complete synthetic scoring/lifecycle integration, database checks, semantic audit and final completion audit remain outstanding.

### Complete synthetic workflow through real API

- Added a UI-authored synthetic questionnaire and scoring package to the no-interception integration suite. The shared scoring workflow exercises explicit option points/caps, guidance, real preview output, independent samples, failed validation and correction, approval/cancellation, activation, retirement, read-only controls and audit actions.
- All four real-API browser runs pass (two scenarios on desktop/mobile). Approved synthetic packages exist only in disposable memory stores. The source template remains unresolved and unapproved.
- Re-ran both opted-in PostgreSQL integration tests: 2 passed, 23 assertions, covering atomic/conflict-safe draft persistence, deletion retry tombstones, concrete assessment binding, retired-version retention, quotas and replay fingerprints. These database checks remain separate from memory-backed browser evidence.
- Remaining: semantic/adversarial review, responsive visual inspection beyond interaction reachability, outstanding scope details and final requirement-by-requirement audit. Goal remains active.

### Identifier lookup audit

- Reproduced an evaluator bug with the valid stable ID `constructor`: inherited object properties were mistaken for previously evaluated questions/calculations. Answer/visibility dictionaries now have no prototype, input reads require own properties, and calculation cache checks use `Object.hasOwn`. Preview controls likewise ignore inherited answer properties.
- Added a regression for supplied zero, required missing input, calculation output and serialized results with that identifier. All eleven evaluator tests pass (60 assertions); workspace tests and all six typechecks pass. Two PostgreSQL tests remain opt-in and were not repeated for this pure-evaluator change.
- Semantic review and the final completion audit remain open.

### Unsaved navigation audit

- Creation now protects template-only changes as well as entered names/review progress when closing or navigating away, and installs a before-unload guard while setup is unsaved or creation is pending.
- Browser back-navigation exposed a confirmation bug: the dialog automatic close reset a navigation blocker after Discard proceeded. Both creation and editing now prevent that automatic close when proceeding with blocked navigation.
- Twelve editor browser runs pass across desktop and mobile, including Keep editing/Discard for creation and editing, template-only cancellation, existing conflicts, reference removal and preview behavior. Admin typecheck and diff whitespace checks pass. The before-unload listener was added but native reload confirmation was not separately exercised in this checkpoint.
- No new dependencies. Semantic validation review, visual inspection and final requirement audit remain open.

### Classification coverage audit

- Found that existing range validation detected internal gaps/overlaps but allowed classifications to omit the lowest or highest configured score. Added approval-blocking coverage validation using component outcomes, nonempty selection aggregation, domain aggregation/caps and final aggregation/cap/rounding.
- Documented that these bounds are conservative: validation does not solve correlations between separate rules, and requires continuous classification coverage across the configured interval. No clinical thresholds or missing-answer defaults are generated.
- Regression checks cover negative points, endpoint exclusivity, rounding, selection sum/max, singleton selections, conditional outcomes and caps. Workspace tests and all six typechecks pass; two database tests remain opt-in and were not rerun for this contracts-only change. All four real-API browser runs pass on desktop/mobile, including synthetic authoring through approval/activation/retirement.
- Responsive visual inspection and final requirement-by-requirement completion proof remain open.
