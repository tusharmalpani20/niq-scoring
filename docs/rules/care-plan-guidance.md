# Care plan guidance: implementation plan and contract

## Scope and source

The rule version stores editable guidance transcribed from:

- `NIQ - Product & interventions sheet.ods`: 12 product plans in `Product_mapping_`, five conditional notes, five `Co-morbidities_diet_guidelines` rows, and three general `Nutrition_intervention_` rows. A separate Jain substitution rule uses the same product guidance as Vegetarian, as directed by the rule owner.
- `Oncology Drug Class & Nutrition Guide (NIQ).ods`: 16 class definitions, class/cancer/treatment suggestions, 136 `Toxicity-Interventions` rows, 48 `Status_modifier` rows, and three `Sheet1` radiotherapy rows.

`Drugs_by_treatment` is used to suggest **classes**, not to collect or infer individual drugs. `Drug_notes` is not selected by the patient or released as drug-specific report guidance. The five workbook notes and the owner-approved Jain note are stored as editable exceptions. `Read_me` remains source context.

## Implementation sequence

1. Seed each new final-assessment rule version with independent copies of the workbook rows. Existing pinned versions keep their original definitions. Editable older drafts receive the care-plan defaults when opened and must be saved through normal revision checks.
2. Map each rule version's editable NIQ risk-category **ID** to a workbook nutritional status: Low Risk → Well nourished, Moderate Risk → Moderately nourished, High Risk → Severely malnourished. Risk labels displayed in the editor come from the current rule version; changing a label does not alter its mapping. Validation requires exactly one mapping for each category.
3. Expose the rows in Rules under **Nutrition & toxicity** and **Care plan rules**. Care plan sections are Risk mapping, Drug-class by status, Treatment guidance, Products & doses, Co-morbidity diet, and Product exceptions. Every row can be edited, enabled/disabled, added or deleted in a draft. The three seeded treatment guidance rows apply to Radiation Therapy; an editor can add rows for other configured treatment types. Workbook provenance remains in the saved definition and is omitted from the list UI.
4. Match guidance using the assessment's pinned rule version and completed scoring result. Class guidance requires a selected class and treatment. Treatment guidance requires its selected treatment type and nutritional status. Existing saved rows without a treatment type continue to mean Radiation Therapy. Co-morbidity guidance requires its selected assessment option. Product plans require a matched nutritional status and treatment stage, with dates for time-bound plans. The server returns one selected product plan or an explicit unresolved state; it does not combine doses.

The admin **Products** tab holds a shared, name-only catalogue, initially seeded with Invigour, Nourish, Protect, Recover, and Liss WH. Products & doses rules use a searchable product list and compact selected-product rows. The rule list resolves selected names against that catalogue; quantities and preparation stay in the rule version. Each selected product requires a numeric quantity, and the plan stores duration in days. Renaming or deleting a catalogue entry does not alter a saved rule or historical report. Older rules with product text and no structured items remain readable. The three workbook Surgical plans put 1 or 2 in Liss WH's quantity field to match the stated scoop count, with "leveled scoops in 150ml water" as its preparation; the severe plan also saves 1 Invigour. The sheet does not state a daily Liss WH frequency, so report wording presents its quantity as scoops rather than per-day servings. Recognized older Surgical doses are converted when an editable draft opens. The report writer receives only a selected matched plan and its saved dose and duration, plus structured product items when present, or an explicit unresolved state; it does not receive the entire catalogue.
5. Verify schema references, duplicate active rows, source-row coverage, class-only wording, exception handling, API binding, and desktop/mobile editor behavior.

## Product decision rules

- Treatment status maps to **Before treatment** (Newly Diagnosed with a planned treatment start within the rule's pre-treatment duration), **During treatment** (Under Treatment with at least one selected treatment), or **After treatment** (Post-Treatment). Palliative Care alone does not establish a product stage. New assessments ask newly diagnosed patients for the planned start date. The completed assessment date, rather than the date the report is generated, anchors the pre-treatment window.
- A completed surgery adds **After surgery** for the rule's number of days after the recorded surgery date. The surgery-note window is separately editable and starts at seven days. A planned surgery within its saved note window adds the reminder to start Liss WH **after** surgery; it does not start a Surgical product plan before surgery. All plan durations are stored in days: 15 before treatment, at least 90 during treatment, 365 or more after treatment, and 30 after surgery by default. The rule owner chose 90 and 365 days for the source's three- and twelve-month recommendations. Known older draft values are converted when opened for editing; custom month values require manual review. The during- and post-treatment durations describe the recommended course; no additional treatment start or end date is collected to calculate those windows.
- Default overlap policy: if Surgical and another stage both match, select only Surgical. The alternate setting asks the clinician to choose. In that state, `plans` is empty and `choices` lists candidates; a subsequent `productStageChoice` selects exactly one.
- Product exceptions save a rule name, one of the supported assessment answers (cancer type, dated surgery status, or diet preference), a structured product action, and an optional explanation. New rules can recommend, remove, limit, replace, or delay a product. The existing surgery plan note remains editable; new rules do not choose between treatment and Surgical plans. Distinct products can share a condition, while conflicting actions on the same product and condition are rejected. Older rows without a saved action or match use their original condition and action for compatibility.
- Exact actions change the selected product plan on the server. Removal and delay delete the named product; a limit caps its daily quantity; a recommendation sets the named product's daily quantity. Replacement defaults to the replaced product's daily quantity, or the editor can save a fixed replacement quantity. A missing daily quantity in an older Surgical preparation instruction cannot be inferred and requires clinician review. If no product remains, or matched rules conflict, the response has no selected dose and explains the review required. Plans containing Liss WH still need a known diet preference; an unconfirmed preference cannot silently receive its workbook dose. The report writer receives the matched actions and final resolved plan, not the entire rule set or catalogue.
- “Other” is exclusive in the drug-class picker and receives only the pre-existing generic nutrition-by-risk guidance. No class, toxicity, modifier, radiotherapy, product or co-morbidity guidance is added to its care-plan packet.

## Guidance API

`POST /v1/assessments/report-guidance` remains deployment-authenticated and verifies the completed score against the assessment's pinned version. Its existing required body fields remain `assessmentReference`, `resultReference`, `treatmentTypeIds`, `drugClassIds`, and `confirmedToxicityIds`. Optional guidance facts:

| Field | Meaning |
|---|---|
| `coMorbidityIds` | Selected `co_morbidities_*` option IDs. |
| `cancerTypeId` | Assessment cancer-type ID; needed to check Nourish exceptions. |
| `dietPreferenceId` | `vegetarian`, `non_vegetarian`, `eggetarian`, or `jain`; needed for Liss WH. |
| `treatmentStatusId` | Selected treatment-status option ID. |
| `plannedTreatmentStartDate` | YYYY-MM-DD assessment answer; needed for the pre-treatment plan. |
| `assessmentDate` | Completed assessment date, YYYY-MM-DD; reference for plan and exception windows. |
| `surgicalStatusId`, `surgeryDate`, `plannedSurgeryDate` | Selected surgery status and its relevant YYYY-MM-DD date. |
| `productStageChoice` | `surgical` or `treatment_stage` when the rule version asks a clinician to choose. |

The response adds `guidance.carePlan` with `nutritionalStatus`, `statusModifiers`, `treatmentGuidance`, `coMorbidities`, and `products`. Each `treatmentGuidance` row carries an explicit `treatmentTypeId`. The saved definition retains the historical `oncology.radiotherapy` key to read existing versions. `products.status` is `selected`, `clinician_choice_required`, `facts_required`, or `none`. Only `selected` contains a dose in `products.plans`. The source's named-drug text remains private to the editable definition.

The Application sends allowlisted answers from the completed assessment to the Scoring report-content endpoint at generation time. It does not retain a second raw-answer snapshot in Scoring. Only matched or clinician-confirmed toxicity guidance is included in the generated draft, and product decisions that require a clinician remain unresolved until reviewed.
