# Care plan guidance: implementation plan and contract

## Scope and source

The rule version stores editable guidance transcribed from:

- `NIQ - Product & interventions sheet.ods`: 12 product plans in `Product_mapping_`, five conditional notes, five `Co-morbidities_diet_guidelines` rows, and three general `Nutrition_intervention_` rows.
- `Oncology Drug Class & Nutrition Guide (NIQ).ods`: 16 class definitions, class/cancer/treatment suggestions, 136 `Toxicity-Interventions` rows, 48 `Status_modifier` rows, and three `Sheet1` radiotherapy rows.

`Drugs_by_treatment` is used to suggest **classes**, not to collect or infer individual drugs. `Drug_notes` is not selected by the patient or released as drug-specific report guidance. The five notes in `Product_mapping_` are stored as editable exceptions. `Read_me` remains source context.

## Implementation sequence

1. Seed each new final-assessment rule version with independent copies of the workbook rows. Existing pinned versions keep their original definitions. Editable older drafts receive the care-plan defaults when opened and must be saved through normal revision checks.
2. Map each rule version's editable NIQ risk-category **ID** to a workbook nutritional status: Low Risk → Well nourished, Moderate Risk → Moderately nourished, High Risk → Severely malnourished. Risk labels displayed in the editor come from the current rule version; changing a label does not alter its mapping. Validation requires exactly one mapping for each category.
3. Expose the rows in Rules under **Nutrition & toxicity** and **Care plan rules**. Care plan sections are Risk mapping, Drug-class by status, Radiotherapy, Products & doses, Co-morbidity diet, and Product exceptions. Every row can be edited, enabled/disabled, added or deleted in a draft. Workbook provenance remains in the saved definition and is omitted from the list UI.
4. Match guidance using the assessment's pinned rule version and completed scoring result. Class guidance requires a selected class and treatment. Radiotherapy requires Radiation Therapy. Co-morbidity guidance requires its selected assessment option. Product plans require a matched nutritional status and treatment stage, with dates for time-bound plans. The server returns one selected product plan or an explicit unresolved state; it does not combine doses.
5. Verify schema references, duplicate active rows, source-row coverage, class-only wording, exception handling, API binding, and desktop/mobile editor behavior.

## Product decision rules

- Treatment status maps to **Before treatment** (Newly Diagnosed with a treatment start within 15 days), **During treatment** (Under Treatment with at least one selected treatment), or **After treatment** (Post-Treatment). Palliative Care alone does not establish a product stage.
- A completed surgery adds **After surgery** for 30 days after the surgery date. The workbook's “just done” note is included only for the first seven days. A planned surgery within seven days adds the reminder to start Liss WH **after** surgery; it does not start a Surgical product plan before surgery.
- Default overlap policy: if Surgical and another stage both match, select only Surgical. The alternate setting asks the clinician to choose. In that state, `plans` is empty and `choices` lists candidates; a subsequent `productStageChoice` selects exactly one.
- Plans containing Nourish need a known cancer type. The pancreatic exclusion or a liver dose above one Nourish per day withholds the plan for clinician adjustment. Plans containing Liss WH need a known diet preference; vegetarian substitution withholds the dose because the workbook supplies no replacement Invigour dose. These states return `clinician_choice_required` or `facts_required` with an explanation.
- “Other” is exclusive in the drug-class picker and receives only the pre-existing generic nutrition-by-risk guidance. No class, toxicity, modifier, radiotherapy, product or co-morbidity guidance is added to its care-plan packet.

## Guidance API

`POST /v1/assessments/report-guidance` remains deployment-authenticated and verifies the completed score against the assessment's pinned version. Its existing required body fields remain `assessmentReference`, `resultReference`, `treatmentTypeIds`, `drugClassIds`, and `confirmedToxicityIds`. Optional guidance facts:

| Field | Meaning |
|---|---|
| `coMorbidityIds` | Selected `co_morbidities_*` option IDs. |
| `cancerTypeId` | Assessment cancer-type ID; needed to check Nourish exceptions. |
| `dietPreferenceId` | `vegetarian`, `non_vegetarian`, `eggetarian`, or `jain`; needed for Liss WH. |
| `treatmentStatusId` | Selected treatment-status option ID. |
| `plannedTreatmentStartDate` | YYYY-MM-DD; needed for the 15-day pre-treatment plan. |
| `surgicalStatusId`, `surgeryDate`, `plannedSurgeryDate` | Selected surgery status and its relevant YYYY-MM-DD date. |
| `productStageChoice` | `surgical` or `treatment_stage` when the rule version asks a clinician to choose. |

The response adds `guidance.carePlan` with `nutritionalStatus`, `statusModifiers`, `radiotherapy`, `coMorbidities`, and `products`. The server supplies the current evaluation date. `products.status` is `selected`, `clinician_choice_required`, `facts_required`, or `none`. Only `selected` contains a dose in `products.plans`. The source's named-drug text remains private to the editable definition. Possible toxicities in the existing packet remain separate from confirmed toxicities; they are not patient diagnoses.

The application does not currently generate a nutrition report or call this endpoint. Its future report composer must pass confirmed assessment facts, use only selected guidance, preserve conditional wording for possible toxicity, and require clinical review of product doses and co-morbidity conflicts before presenting patient advice.
