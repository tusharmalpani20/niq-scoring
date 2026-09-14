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
