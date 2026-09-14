# Rule definition format 1

Definitions are bounded declarative JSON, validated by `packages/contracts/src/rule-definition.ts`. No scripts, dynamic property access or executable expressions are accepted. Save rejects structural integrity errors; unfinished clinical content remains saveable as a draft with blocking issues. Approval requires structural, content and sample validation of the exact saved revision.

## Identity and order

Array order determines section/question/option display order. IDs use lowercase letters, digits and underscores, start with a letter, and are globally unique within a definition. Labels and ordering are mutable in drafts without changing IDs. IDs `total` and `classification` are reserved for computed result references. References to options must use an option belonging to the referenced question. Removing or changing a referenced object requires repairing its dependants in the same save. Published definitions cannot change; incompatible meanings require a new ID in a new draft.

## Conditions and dependency phases

A condition is an `all` or `any` group of comparisons. Operators: equality/inequality, numeric comparisons, multi-select `includes`, and explicit `answered`/`unanswered`. Visibility may read other questions only. Calculations may read numeric questions and other calculations. Scoring conditions may read questions/calculations. Interventions may additionally read domains, total and classification. This phase ordering prevents scoring from depending on its own output. Visibility/calculation dependency cycles are invalid.

Unknown or absent values do not satisfy inequality comparisons by default. Presence checks are explicit. Hidden answers are excluded from evaluation even when submitted, so stale hidden values cannot affect scores. Question and option IDs not in the definition are rejected. Null/absent/empty text means missing; numeric zero and boolean false are actual answers. Unknown/not-applicable choices must be explicit options, with explicit scoring or an unresolved issue.

## Calculations

Supported operations are sum, subtraction, multiplication, division, BMI and percentage change. Subtraction/division take two ordered operands. BMI takes weight in kg then height in cm. Percentage change takes baseline weight then current weight: `(baseline-current)/baseline*100`, positive for loss. BMI requires positive height and weight; percentage change requires positive baseline. Division by zero or nonfinite results are unavailable, never zero. Each calculation has 0–6 decimal precision. Calculations use the rounded result of dependencies, and rules compare those defined values.

## Scoring and classification

Rules assign explicit option points (sum/max, optional cap), numeric bands with explicit inclusive/exclusive edges, or conditional points with explicit otherwise points. Each rule belongs to one domain; domains sum their rule points and optionally cap them. The final result sums or takes the maximum of domains, optionally caps and rounds to the declared precision. All option mappings include explicit zero entries. Overlapping/gapped numeric bands block validation; a runtime unmatched band yields an incomplete result.

Classifications select by final score. Their bounds must be explicit. Conditions may refer to the classification ID, not the display label. Unresolved blocking source issues prevent a complete/clinically usable evaluation even when partial components can be shown in preview.

## Interventions

Interventions carry a kind, condition, text, numeric priority and optional exclusion-group ID. Higher priority wins within an exclusion group; tied group priorities block validation. After a higher-priority item matches, lower-priority alternatives in that group are skipped, including their answer requirements. An unknown higher-priority condition still makes guidance incomplete: a lower-priority match cannot establish the winner. Unanswered conditions for independent guidance also remain incomplete. Matching nonexclusive recommendations are retained in priority order. Repeated kind/text is emitted once. Guidance does not record what a clinician prescribed or did.

## Scope and data

Definitions may describe identity/clinical-note fields for the consuming application; that does not authorize storing patient identities in scoring. Public projection and evaluation must preserve this boundary. Preview/sample data is synthetic and does not enter usage or patient records. Source issues record their document, location and resolution. The source spreadsheet template remains blocked until its disputed clinical rules are deliberately resolved.
