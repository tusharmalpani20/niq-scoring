# NIQ final assessment: implementation handoff

Historical implementation plan, audited on 17 September 2026. Implementation is now complete for the scoring scope. This document preserves the original handoff and is not the current scoring specification.

Later client confirmations supersede the provisional decisions below: mild weight loss is below 6%, moderate is 6–10%, and severe is above 10%; assessment risk categories are Low Risk 0–15, Moderate Risk 16–25, and High Risk above 25. Face-scan scoring is configured separately. See [definition-format.md](definition-format.md), [management-api.md](management-api.md), and [final-assessment-integration.md](final-assessment-integration.md) for current behavior. Live CarePlix capture and interventions remain outside the completed scope.

## Assignment

Implement the final NIQ assessment configuration and scoring flow end to end in **NIQ Scoring only**, following this plan. This handoff is intended for a Luna agent with xhigh reasoning. Inspect the repository and its instructions before editing. Use the simplest maintainable implementation, reuse existing components and dependencies, and commit small, independently understandable chunks. Do not stop after building a visual prototype: deliver contracts, engine, API, UI, tests, documentation, and a reviewable result.

Repository: `/home/tm/Desktop/work/NIQ/application/niq-scoring`.
Authoritative workbook: `/home/tm/Desktop/work/NIQ/Document Recieved/Final NIQ Assessment Form_with section_field_details.xlsx`, worksheet `Sheet1`.
Approved design reference: `docs/rules/final-assessment-ui-reference.png`.

The workbook plus the explicit decisions below supersede the previous workbook and demo for NEW versions. Existing versions must preserve their original definitions and evaluation behaviour. Do not modify NIQ Application, overwrite existing records, change credentials, deploy, merge into main, or push as part of this implementation. The user will review the completed work first.

## 1. Confirmed product decisions

- Fields, options, calculations and section membership are fixed by the final assessment. This is a scoring configuration editor, not a form builder.
- Administrators configure scoring points and applicable score ranges, names/descriptions and risk categories. They cannot create arbitrary questionnaire fields/options, alter fixed formulas, or reassign section membership.
- There are **no caps whatsoever** in the new profile: no option cap, GI symptom cap, group cap or overall cap. Do not retain the previous 35-point ceiling or the five old capped score groups.
- Every selected multi-select option contributes its points; aggregate with SUM, never MAX. Reject duplicate option IDs in submitted answer arrays to avoid counting an option twice.
- Unanswered optional inputs stay unanswered and are excluded from score contribution. Do not store or represent them as an explicit zero answer, and do not mark the whole assessment incomplete solely because optional fields were skipped.
- An explicit zero-point answer remains an answered field. Contract convention: an explicitly submitted empty selection represents answered none and scores zero; omitted/null remains unanswered. This is an implementation convention, not an additional workbook option. Do not invent selectable None options.
- Weight-loss bands: no change or weight gain = 0; positive loss below 5% = 1; 5% through 10% inclusive = 2; above 10% = 3.
- Protein adequacy: Normal intake OR More than usual = Adequate, 0 points. Reduced intake, Liquid diet, Little solid food, Tube feeding = Inadequate, 1 point. This explicitly corrects the duplicated 'More than usual' in H152.
- No patient identity fields in the new scoring profile, editor, scoring request or answer logs. Exclude Name, Contact, Age, Gender, identifying free text, family member names, and surgery dates. Necessary non-identifying scoring measurements remain supported.
- Reports Upload is pending: no upload UI, storage, OCR, report parsing or extraction in this task.
- Interventions remain N/A, not finalized. Do not invent intervention logic.
- Risk thresholds are temporary development data, not client-confirmed clinical rules. Mark them clearly and prevent clinical approval/use server-side until separately confirmed.
- User requested small commits during development. No new packages are expected. If one becomes necessary, explain what it solves and why existing packages are insufficient before adding it.

## 2. First inspect; then implement

Check git status, current branch, repository AGENTS instructions and existing local changes. Preserve unrelated changes. Start a new feature branch from current main (suggested `feat/final-assessment-v2`). Do not reset main or lose changes to obtain a clean tree.

Read these code paths and their tests, plus actual current routes before changing behaviour:

- `packages/contracts/src/rule-definition.ts`, `rule-template.ts`, `fixed-profile.ts`, `rule-validation.ts`, `rule-score-bounds.ts`, `rule-public.ts`.
- `packages/scoring-engine/src/rule-evaluator.ts`, `rule-answers.ts`, and the runtime scoring entry points.
- `apps/api/src/rule-routes.ts`, scoring/assessment routes, lifecycle/approval checks, persistence and auditing.
- `apps/admin-web/src/rules/RuleEditor.tsx`, `ScoringEditor.tsx`, `RiskCategoriesEditor.tsx`, `ScoreGroupsEditor.tsx`, `RuleCreate.tsx`, `RulePage.tsx`.
- Existing shared controls and routing/unsaved-change handling.
- `docs/rules/definition-format.md`, `assessment-api.md`, `management-api.md`, `browser-testing.md`.

Re-read the final workbook including merged-cell anchors; do not treat blank continuation cells as missing field metadata. Record cell references in source metadata and technical documentation, not repeated messages throughout the product UI. Compare this plan against the actual workbook. Escalate a genuine new scoring contradiction; do not silently guess a clinical rule.

## 3. Final profile: five scored sections, 19 scoring entries

Use stable internal IDs. Reuse an existing ID only when its meaning remains compatible; do not reinterpret legacy stored answers. Record explicit profile identity so runtime dispatch is deterministic.

Workbook colours are section accents, not risk colours. Use accessible, subtle versions of orange, green, grey, purple and beige; do not communicate status through colour alone.

### 3.1 Disease status — orange — 3 scored fields

Source: rows 11–49.

| Field | Type | Options and default points |
|---|---|---|
| Type of tumour | Multi-select | Solid Tumour 2; Haematological 1; Metastatic / Secondary 3; In Situ 1 |
| Stage | Select | Localized (stage 1–2) 1; Locally Advanced (stage 3) 2; Metastatic (Stage 4) 3 |
| Relapse status | Select | First Diagnosis 0; Relapsed 1; Refractory 2 |

Do not carry over old tumour behaviour/origin scoring as additional rules: the new tumour options replace that structure. Type of cancer and metastasis-site descriptions are not scoring inputs and do not need to be displayed or collected in NIQ Scoring.

### 3.2 Treatment — green — 5 scored fields

Source: rows 50–88.

| Field | Type | Options and default points |
|---|---|---|
| Treatment status | Select with conditional choices | Newly Diagnosed 0; Under Treatment 2; Post-Treatment 1; Palliative Care uses the branch below |
| Cancer surgical status | Select | Surgery Done 1; Planned 2; Not Required 0; Not Fit for Surgery 3 |
| Current cancer treatment | Multi-select | Chemotherapy (Cytotoxic) 3; Immunotherapy 2; Radiation Therapy 1; Targeted Therapy 1; Hormonal Therapy 1; Other treatment 1 |
| Current medications | Multi-select | Each listed medication +1; explicit none 0 |
| Supplements intake | Multi-select | Each listed supplement +1; explicit none 0 |

Medication options: Blood Thinners; Anti-hypertensives (BP meds); Anti-diabetics; Thyroid; Cholesterols; Steroids; Anti-histamines; Pain medications; Antibiotics; Antacid. Preserve source wording or make harmless spelling/capitalization corrections with stable IDs.

Supplement options: Protein supplements; Iron; Calcium; Folic Acid; Multivitamins; Omega-3.

Palliative branch (F53:G53):

- With Cancer any stage → 3 points.
- Post treatment → Within 6 months 3; Within 12 months 2; Post 12 months 1.
- Model those as fixed nested categorical choices, not inferred dates or invented time calculations. Only the active leaf contributes; do not also add the ordinary Post-Treatment point.
- If Palliative Care is selected but a necessary child choice is absent, mark that scoring entry unanswered/pending and omit its contribution; explain the missing dependency. Do not fall through to a zero-point alternative.
- For the new profile, reject non-null supplied inactive child answers as contradictory input; null/omitted children are allowed. The caller must clear a child when its parent changes. Do not alter legacy branch handling.

Do not request surgical dates, cycle details or biochemical inputs here: they do not affect scoring in the final workbook. In particular, remove creatinine/CRP scoring from the new profile.

### 3.3 Health history — grey — 3 scored fields

Source: rows 89–100.

| Field | Type | Options and default points |
|---|---|---|
| Co-morbidities | Multi-select | +1 per selected disease; explicit none 0 |
| Previous surgeries | Yes/No with count | No 0; Yes → number of surgeries × 1 point |
| Family history of cancer | Yes/No | Yes 1; No 0 |

Co-morbidity options: Diabetes; Hypertension; Thyroid Disorder; Kidney Disease; Liver Disease; Cardiac Disease; High Cholesterol; Psychological Disorders.

Surgery count must be a positive safe integer when Yes is supplied; zero surgeries should use No. No cap. Missing count leaves the contribution unanswered. Validate negatives, fractions and contradictory values without silently repairing submitted answers. Do not collect dates, surgery descriptions, family relationship text or family identities in scoring.

### 3.4 Clinical & GUT health — purple — 2 scored fields

Source: rows 101–119.

| Field | Type | Options and default points |
|---|---|---|
| Appetite status | Select | Normal 0; Reduced 2; No Appetite 3 |
| Gastrointestinal symptoms | Multi-select | +1 per symptom; explicit none 0; NO CAP |

GI options: Bloating; Acidity / Reflux; Nausea; Vomiting; Early Satiety; Taste Changes (Dysgeusia); Dysphagia; Pain while eating; Mouth Ulcers / Mucositis.

Bowel pattern and stool frequency are explicitly non-scoring. Do not include their old score rules. Keep GI symptoms separate from Dietary symptoms: both are independently scored in the supplied form; do not silently deduplicate them across questions.

### 3.5 Dietary details — beige — 6 scored fields

Source: rows 120–156.

| Field | Type | Options and default points |
|---|---|---|
| Weight loss/gain | Calculated range | Gain/no change 0; loss >0 and <5% 1; loss 5–10% inclusive 2; loss >10% 3 |
| Symptoms | Multi-select | See exact points below; sum selections |
| Functional capacity | Select | Normal Activity 0; Reduced Activity 1; Bedridden 2 |
| Stress level | Select | High 2; Moderate 1; None / Low 0 |
| Protein intake | Derived from dietary intake | Adequate 0; Inadequate 1 |
| Fluid intake | Select | <1 litre 3; 1–2 litres 2; >2 litres 1 |

Dietary symptom options and points (F132:G145): No problem while eating 0; No appetite, just did not feel like eating 3; Nausea 1; Vomiting 3; Constipation 1; Diarrhoea 3; Mouth sores 2; Dry mouth 1; Things taste funny or have no taste 1; Smells bother me 1; Problems while swallowing 2; Feel full quickly 1; Fatigue 1; Muscle loss 3.

As an explicit data-integrity convention, treat 'No problem while eating' as mutually exclusive with symptom selections. Enforce this in validation, rather than allowing contradictory answers that happen to add zero.

Weight calculation:

`lossPercent = (previousWeightKg - currentWeightKg) / previousWeightKg * 100`

Inputs: current weight and weight 1–2 months ago, in kg. Both must be finite and greater than zero. Missing input means the derived contribution is unanswered; zero/negative supplied weights are invalid. Compare the unrounded percentage with boundaries so rounding cannot move a 4.999% loss into the 5% band. Round only display values as appropriate and document that choice. Test exact 5%, exact 10%, values on either side, gain and no change.

Protein dependency: dietary intake is a fixed, non-scoring select input with Normal Intake; More than usual; Reduced Intake / less than usual; Liquid Diet; Little solid food; Tube Feeding. Map the first two to Adequate and the remaining four to Inadequate. Missing intake leaves derived protein classification and score unanswered. The caller must not be able to override calculated adequacy or the derived weight-loss category.

Do not add BMI/height simply because they exist in the form: BMI is non-scoring and not needed for these calculations. Necessary weights and dietary intake appear as supporting inputs in the relevant expanded scoring editor, not as patient records or editable answers in the admin UI.

## 4. Missing values, totals, privacy and API behaviour

Define and test these semantics explicitly in the shared contract and engine:

- Omitted/null optional value → unanswered; contribution null/absent with a clear status, never an explicit zero contribution.
- Explicit zero-point option, No, or explicit empty multi-select → answered; contribution 0 where defined.
- Partial optional responses produce the sum of answered scoring entries; no missing-value imputation and no normalization to a percentage.
- If ALL scoring entries are unanswered, return no score (`null`) and no risk classification, not a reassuring zero/Low result. This is the implementation interpretation of 'do not consider unanswered'; document it clearly.
- Supply answered/unanswered counts or equivalent structured completeness metadata, including for derived/conditional entries. Do not use 'complete' to imply all 19 optional entries were answered. Preserve legacy semantics for old profiles.
- Invalid supplied values are errors, not unanswered values to silently discard.
- Count/sum scoring can exceed the old maxima. Avoid theoretical-score-bound algorithms that require a finite total cap.
- Do not add a hidden cap via UI max values, evaluator clamping, database constraints or obsolete validation rules.
- Reject unknown answer keys, including identity fields, for the new profile. Do not log raw answer bodies in request/audit/error logs or persist real patient inputs in samples/previews. Clearly synthetic test fixtures and configuration sample cases are allowed. Preserve existing idempotency/result evidence storage; audit its allowlisted response fields so it does not introduce raw answer or identity storage. Audit configuration changes using the existing mechanism without identity or measurement payloads.
- Keep version/revision attribution in results. Keep existing authentication, client isolation, entitlement accounting, idempotency and structured error conventions intact.

### 4.1 Configuration errors versus skipped answers

Missing patient answers and missing score configuration are different. An optional unanswered field contributes nothing. An answered field whose points/rate/ranges are absent is a configuration error; never skip it to produce a plausible total. Drafts may retain explicitly incomplete configuration, but evaluation requires a structurally valid scoring configuration. Separate invalid configuration, answer validation errors, unanswered contributions and provisional-readiness notices in the result model.

Points and count rates are finite non-negative numbers. Counts are positive safe integers. Validate edited ranges for gaps/overlaps over the supported input domain. Reject non-finite/unsafe arithmetic results with a structured error; do not clamp them or impose an arbitrary clinical cap. Compare derived values before presentation rounding and test decimal boundaries without applying a broad tolerance that shifts the intended bands.

### 4.2 Runtime and readiness integration

The current evaluator clears scores whenever any component is missing, rounds calculations before scoring, and requires classification for `complete`. The assessment route rejects `!result.complete` before reserving usage. Implement explicit v2 evaluation semantics and update callers together; changing only the table/template is insufficient.

For v2, distinguish successful computation from answer coverage. A valid partial response with at least one answered scoring entry produces an additive score, with answered/unanswered counts. An explicit zero answer qualifies. An all-unanswered response has null score/classification, returns the existing structured incomplete response through the assessment API, and consumes no usage. Invalid answers/configuration also consume no usage. Successful service calculations preserve existing billing, idempotency and concurrency behaviour. Retain existing v1 result semantics and response handling.

Provisional risk thresholds are a readiness blocker, not an arithmetic error. Internal authenticated draft evaluation and synthetic tests must still compute scores and explicitly provisional classifications. Public service evaluation must reject provisional versions before calculation/usage reservation, including existing bindings or direct route bypasses; inspect binding, approval, activation and runtime paths. Until client confirmation, no save payload may make the final profile clinically ready. Document the later controlled confirmation change; do not build a new approval-management feature in this task.

Existing approval validation requires sample cases, including a successful case. Adapt this deliberately for v2: supply synthetic golden fixtures covering representative scoring paths, distinguish fixture mismatch from provisional readiness, and allow draft evaluation while approval remains blocked. Expected values must be independently written, not generated by the same evaluator being tested. No patient-derived fixtures.

Keep formula dependencies acyclic and fixed. Reject submitted derived-answer keys, unknown keys, wrong types, contradictory branches and duplicated options before evaluation. Type-check explicit empty arrays before applying missing-answer conventions. Count derived/conditional entries once each; supporting inputs do not increase the total of 19 scoring entries.

## 5. Contract/schema and legacy compatibility

The existing schema is formatVersion 1 and assumes scoring rules belong to domains. A change to missing-answer semantics and uncapped conditional/count scoring must have an explicit compatibility boundary.

Use an explicit formatVersion 2 definition with a fixed final-assessment profile identifier, parsed through a discriminated union alongside the unchanged formatVersion 1 schema. Dispatch validation, template checks, public projection and evaluation by format version/profile. Do not make a global evaluator change that reinterprets old saved versions. Keep shared primitives where useful without forcing legacy domain/cap requirements into v2.

Required capabilities:

1. Fixed section identity, order, allowed options, supporting inputs, and profile marker.
2. Uncapped additive scoring without user-managed domain assignment.
3. Typed conditional/derived scoring for palliative status, previous-surgery count, protein adequacy, and weight loss.
4. Per-entry unanswered status distinct from explicit zero; aggregate result supporting a missing total when nothing is answered.
5. Provisional risk-threshold metadata enforced by backend lifecycle/runtime paths.
6. Editable points/ranges without altering source-owned questionnaire structure or fixed formula/dependency graph.

Reuse safe declarative operations. If count multiplication or conditional lookup needs a schema extension, add a small typed operation and explicit validation. Never introduce executable scripts, eval, arbitrary formulas, or a generic form-builder framework.

The new profile should contain no operative cap settings. Reject cap properties in the strict v2 schema; retain them only in the legacy schema. Sections may support subtotals internally, but cannot impose limits or require manual field-to-group assignments.

Creation must use the new final template. Existing saved versions must stay readable and evaluable under their original rules. Do not silently migrate them or reinterpret their old fields. Preserve supported existing actions; if duplication retains an old profile, label it honestly. A new final-assessment version is the path to adopt the new rules. Do not delete legacy cap handling needed for historical evaluation.

Inspect persistence before adding a migration. JSON definition changes may not need SQL DDL. If relational changes are required, add a normal tracked migration and a rollback/recovery note; never rewrite production records by script.

Update exported public schema, API docs and frontend types consistently. The new public projection describes scoring inputs and their dependencies only; it is not the full patient assessment form. Preserve the current endpoint envelope where possible and discriminate its inner schema. Never expose editable points or internal scoring configuration through the public input projection. Explain request changes to the NIQ Application agent in a concise integration note; do not edit that application's repository.

## 6. Temporary risk categories

User authorized dummy categories for development pending client confirmation. Seed explicitly synthetic thresholds for exercising the UI: Low below 16; Moderate at least 16 and below 26; High at least 26, with no upper bound. These are DEVELOPMENT PLACEHOLDERS, not workbook-derived medical thresholds or confirmed equivalents of the old model.

- Show one concise 'Temporary thresholds — awaiting confirmation' notice on the Risk categories tab.
- Keep category editor name, meaning, From score / To score controls, add/remove and duplicate-name validation.
- Require non-overlapping coverage for all possible new totals; the highest band must accommodate an unbounded total when count scoring has no upper bound.
- Backend must prevent clinical approval/activation with provisional thresholds, even if the UI is bypassed. Do not let an ordinary save or boolean in a submitted payload silently remove the provisional state.
- Development evaluation may expose the provisional classification with explicit provisional metadata. Production/client clinical evaluation must follow the approval gate; never present dummy labels as validated clinical results.
- No-score results get no classification.
- Keep interventions N/A, and avoid importing old recommendations or clinical interpretation text as if newly confirmed.

## 7. UI implementation specification

Follow the approved image closely for hierarchy, spacing, surfaces and interaction, using existing NIQ typography, teal actions, icons, inputs, tabs and Select components. This is an app implementation, not a static image recreation.

### Page shell

- Keep breadcrumb 'Rule versions / [name]', version title, lifecycle badge, and version/revision context.
- Keep top tabs: Details, Scoring, Risk categories, Interventions.
- Scoring is the default selected tab.
- Keep details simple: Name and Description. No repeated workbook-provenance banners or technical source-decision forms.

### Section navigation

Desktop: compact section navigation beside one content card. Entries are Disease status (3 fields), Treatment (5), Health history (3), Clinical & GUT health (2), Dietary details (6). Counts reflect visible scored entries, not how many answers a patient supplied. Use section-colour dots/strips and a subtle selected state; labels remain readable independently of colour.

Narrow viewports: replace this navigation with a labelled shared Select control. Do not squeeze both a global sidebar and another navigation column beside an unreadable table. Avoid viewport horizontal overflow. Preserve selected section while changing top-level tabs.

### Scoring table and inline editor

- Heading and concise helper within the section card.
- Three columns only: Field name | Type | Scoring.
- Types: Select, Multi-select, Yes/No, Calculated, or conditional label appropriate to the rule.
- Summaries: '4 options configured', '3 ranges configured', or concise equivalent for conditional/count fields. Do not falsely count absent mappings as configured. Zero is a configured score.
- Click the score summary or a clearly labelled disclosure button to expand that field beneath its row. One field expanded at a time. Switching sections preserves edits.
- Option editor: Answer | Points, aligned compact numeric controls. Preserve blank/intermediate numeric text across disclosure, section and tab changes; never coerce blank/invalid input to zero. Zero counts as configured; missing points do not. Fixed answer labels cannot be changed. Show 'Selected answers are added together' only where helpful.
- Treatment status: show ordinary options and a clearly indented Palliative subsection with fixed child paths and leaf points; no technical condition builder.
- Surgery count: explain 'Number of previous surgeries × points per surgery' and expose its editable point rate, not a giant or finite range list.
- Weight loss: show required inputs and a read-only plain-language formula plus editable range/points controls. Maintain full boundary correctness and detect gaps/overlaps inline. Formula remains fixed; constraints for gain/no-change cannot become an arbitrary scripted calculation.
- Protein: show the six intake choices grouped into the two fixed derived outcomes and their editable points. Do not allow changing the dependency mapping.
- No personal details, non-scoring standalone rows, Cap column, Score groups table, Domain dropdowns or dead 'Not applicable' rows.

### Risk categories / interventions

Use existing simplified risk editor styled consistently. Keep native-looking select replacements consistent with shared controls. Expose readable boundary summaries. Interventions shows a compact N/A state only.

### Save and feedback

- One shared footer: unsaved/saved state, Discard changes, Save draft.
- All edits across sections/tabs belong to the same draft; saving is not section-specific.
- Discard restores the last saved definition after the existing confirmation when dirty; it must not navigate away or erase persisted data.
- Preserve dirty-navigation guards on breadcrumb, global sidebar, browser Back and refresh. Avoid the historical double-confirmation bug.
- Retain revision conflict protection: on conflict keep the edits, show a useful message, and offer deliberate reload/discard; do not overwrite a newer revision.
- Show input-specific errors near controls, mark the relevant section, and focus/scroll to the first issue on failed save. Do not only dump technical errors at the bottom of a long page.
- Save schema-valid incomplete drafts if existing workflow supports it, but keep approval blocks truthful. Never imply clinical readiness because a draft was saved.
- Approved/history views remain read-only; inputs, portal-based selects and mutation actions must all respect disabled state.
- Keyboard-accessible disclosures, labelled controls, visible focus, proper table headings, accessible status announcements and sufficient contrast are required.

## 8. Implementation stages and small commits

Keep stages coherent, normally one commit per meaningful completed stage. Split further when justified; never combine schema, UI redesign and unrelated cleanup into one giant commit. Run relevant tests before each commit; do not leave a commit knowingly broken.

1. **Profile contract and compatibility:** explicit profile/version strategy, parsers/types, legacy regression fixtures, fixed-structure validation, privacy allowlist. Commit.
2. **Final template:** five sections, all 19 scoring entries, supporting inputs, exact source options/defaults, no caps, provisional risk metadata. Table-driven source inventory tests. Commit.
3. **Scoring engine:** optional answers, additive multi-select, conditional leaves, linear surgery count, derived protein and weight scoring, uncapped totals, output metadata, legacy preservation. Commit.
4. **API/lifecycle:** create new profile, save/reopen/duplicate compatibility, fixed-field protection, no-cap enforcement, risk provisional gate, public contract and no-identity handling. Integration tests. Commit.
5. **Section-based scoring UI:** desktop menu/mobile select, focused table, disclosures and all rule-specific editors; omit private/non-scoring fields and cap/group UI for the new profile. Commit.
6. **Risk editor/save polish:** provisional notice, field/section validation, persistence across tabs, dirty/discard/conflict handling, accessibility/responsiveness. Commit.
7. **End-to-end verification and handoff:** targeted bug fixes, complete relevant tests, screenshots and integration documentation. Commit fixes in small chunks, then give a completion report.

Before a commit, review the diff, stage only relevant files and avoid secrets, test artifacts, node_modules, workbook copies or unrelated changes. Do not use `git add .` without inspecting everything. Do not push or merge until the user requests it after review.

## 9. Verification matrix

### Contract/template tests

- Five scoring sections, counts 3/5/3/2/6, exactly 19 scored entries; workbook options/points match the tables above.
- New fields/options/formulas/section reassignment rejected when tampered through API, not just locked in UI.
- Cap properties and max aggregation rejected for final profile; valid legacy versions retain original capabilities.
- Category names unique ignoring case and repeated/leading/trailing spaces.
- Invalid/missing references, duplicate option IDs, invalid counts, nonfinite values, unknown answer keys and identity fields rejected.
- Provisional marker cannot be removed through an unauthorized save path.

### Engine tests

- Every single-select option and every multi-select option has a known expected contribution.
- Multiple selections sum; duplicate submissions cannot inflate totals; nine GI symptoms score 9.
- All medications = 10; all six supplements = 6; all eight co-morbidities = 8 with default points.
- Total can exceed 35 and is not clamped; count contribution can exceed any old domain limit.
- Every palliative leaf, unanswered child and inactive branch; no double counting.
- No surgery 0; Yes/count 1 and larger count; missing count unanswered; invalid negative/fraction/zero count rejected when Yes.
- Weight gain/no change/4.999%/5%/10%/10.001%; missing weights; invalid weights; no preclassification rounding.
- All six dietary intake answers, especially More than usual → Adequate 0; omitted intake unanswered; submitted derived values cannot override calculation.
- Unanswered versus explicit zero/No/empty selections, partial assessment, all unanswered, dependent unanswered; accurate counts.
- Risk boundaries and no-score result; provisional labels never leak as clinically approved.
- Legacy fixture results identical before/after implementation, including historical caps and missing-answer semantics.

### Frontend and browser tests

- Create opens the final profile; direct route and refresh work; old version remains readable. The bookmarked TEST record is legacy: create a new final-profile draft to demonstrate the redesign, never silently convert TEST.
- Five section choices with correct counts; no identity rows/caps/groups for new profile.
- One expansion at a time, accessible keyboard operation, edits survive section/tab changes and save/reopen.
- Option points, conditional palliative points, surgery-rate editor and calculation-range editor persist correctly.
- Duplicate risk names and bad ranges produce useful local errors; missing configuration marks the right section.
- Read-only controls cannot mutate, including portal-based dropdowns.
- Cancel/discard/navigation/reload and concurrent-save conflict flows preserve user work as intended.
- Desktop and mobile screenshots: no overflow, clipped text, nested-scroll traps or footer covering fields.

### API and privacy tests

- Actual create/save/get/evaluate flows with correct authentication and structured errors. Cover valid partial scoring, all-unanswered no-charge, invalid input no-charge, successful exactly-once charging, idempotent replay and concurrent requests. Test public provisional rejection independently from internal draft evaluation.
- Approval blocked for provisional categories and incomplete definitions.
- Raw identity input rejected; no raw patient payload retained in logs/audit/sample persistence.
- Existing tenancy/credential authorization and usage-accounting tests remain passing.
- Use actual PostgreSQL integration checks where the project provides them; distinguish those from in-memory fixtures.

Run relevant project commands after inspecting current package scripts:

```
bun run typecheck
bun run test
bun run build
bun run --cwd apps/admin-web test:browser
bun run --cwd apps/admin-web test:browser:integration
```

Browser suites share outputs/ports: run separate browser configurations sequentially. Use synthetic test records; do not mutate/delete user versions for browser checks. Review generated screenshots, not only test exit status. Report unavailable external dependencies and pre-existing failures accurately.

## 10. Completion and review handoff

Deliver:

- Branch and ordered commit list, with concise purpose per commit.
- What changed in UI, contracts, engine and API.
- Screenshots of Disease status with expanded options, Treatment with palliative configuration, Dietary weight-loss/protein editors, Risk categories, and one narrow-screen view.
- Exact tests executed and results; limitations and pre-existing failures separated.
- A short NIQ Application integration note: profile/version identity, accepted input IDs/types, conditional inputs, unanswered semantics, derived inputs, response shape, provisional classification behaviour, and identity exclusion.
- Whether SQL migrations were required and why.
- Remaining external decisions: confirmed risk thresholds and Reports Upload requirements. Do not present these as completed.

Do not claim end-to-end completion if runtime evaluation still uses the old profile, new definitions cannot be saved/reopened, identities remain accepted, caps still apply, or provisional risk labels can be approved for clinical use.

The user and reviewing agent will inspect the implementation after completion. Finish with a concise report, not a request for permission to perform already-authorized work.
