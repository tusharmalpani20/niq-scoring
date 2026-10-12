# Toxicity match review

Sources: `Document Recieved/NIQ Report/final/Oncology Drug Class & Nutrition Guide (NIQ).ods`, `Toxicity-Interventions` rows 2–137; `Document Recieved/Final NIQ Assessment Form_with section_field_details.xlsx`, `Sheet1` rows 101–156; and the Application assessment form. The oncology source was checked against all 136 imported rule rows.

These are proposals for manual review. The rule editor shows them under **Nutrition & toxicity → Drug-class toxicity** and can fill them into a draft for inspection. A reported symptom supports only that symptom. It does not establish its cause, severity, named drug, or a diagnosis.

- **Patient symptom**: the selected answer may make the row's advice relevant when treatment and drug class also match. Report text must use the observed symptom wording, not automatically assert the full clinical source label.
- **Clinician confirmation**: the form does not directly establish the full effect, or its combined advice cannot safely be selected from one answer. Do not infer it from treatment or drug class alone.
- **Row 80** combines constipation and diarrhea advice. Keep clinician confirmation unless the guidance is split into separate symptom-specific rows.

## Re-audit after assessment field comparison

All 136 source rows were compared with the selectable answers in the Scoring questionnaire, the Application assessment, and the calculated weight result. In the saved `TEST2 copy` draft, **46 rows use a reported answer, 3 use measured weight gain, and 87 require clinician confirmation**. No row lacks a matching method. The four identically worded **Fatigue / reduced appetite** rows (9, 86, 103, 133) use **Any one** of Fatigue, Reduced appetite, or No appetite, as requested. The eight **Nausea and vomiting** rows use Any one only because their shared advice applies to either complaint; vomiting-specific advice is conditional. Four further appetite/taste/fatigue rows (26, 53, 66, 76) use Any one with compatible advice. These matches must never be reported as proof of every effect named in the source title, its severity, named drug, or treatment cause. An editor can select **All** for a rule that truly requires every chosen answer.

**Weight gain:** rows 107, 118, and 122 match only when both weights are valid positive numbers and current weight exceeds previous weight. The score band called “weight gain or no change” is not used, because it also covers unchanged weight. This is an observed increase, not evidence of fat gain or its cause. The Application's prior completed assessments are currently used for the report chart, not supplied as the Scoring match baseline; the assessment's own previous weight field must be present. Row 121 (“Muscle loss and fat gain”) stays clinician confirmed.

The following rows still need content review before changing their matching method:

| Rows | Finding | Current treatment |
| --- | --- | --- |
| 12, 29, 83 | Nausea/vomiting advice fits either answer, but the source titles add unmeasured severity or a named drug. | Matched by either answer in the draft; report wording must name only the answer observed. |
| 26, 53, 66, 76 | Compatible advice spans several reported effects. Row 66's weight loss is not established by a fatigue or appetite answer. | Matched by any relevant answer; show only observed effects in patient-facing prose. |
| 37, 55, 63, 126 | Source titles contain extra effects or diagnoses not established by the available answer; row 126 also lacks diarrhea advice. | Clinician confirmation until patient-facing titles/content are corrected and reviewed. |
| 45, 80 | These rows mix distinct advice. Row 80 includes opposing constipation and diarrhea plans. | Clinician confirmation; split before using any one symptom to select the full row. |
| 97 | A diarrhea answer does not diagnose immune-related colitis. | Clinician confirmation pending review of patient-facing warning wording. |
| 126 | The source label lists diarrhea, but its intervention has only fatigue and appetite advice. | Clinician confirmation; correct the source-derived rule before matching diarrhea. |
| 47, 48 | The questionnaire does not capture the timing or severity that distinguishes early and late diarrhea. | Clinician confirmation. |

The Application also asks about bowel pattern, but that field is Application-owned and is not supplied to the Scoring matching contract. The Scoring **Symptoms** field already supports direct diarrhea and constipation matches. Stool frequency alone does not establish diarrhea severity, and “Alternating” cannot select the opposite constipation and diarrhea plans. The workbook lists biochemical measurements, but the current Application form does not collect structured lab values for them. Other visible effects (for example neuropathy, edema, hot flashes, rash, hearing changes, and joint pain) do not currently have dedicated selectable answers. Clinical findings such as low blood counts, raised liver enzymes, and electrolyte abnormalities require clinician evidence.

The direct matches should be rendered as **reported symptoms or observed weight change**. Source qualifiers such as “mild,” named drugs, high dose, or treatment causation are not established by those answers. The report evidence packet no longer calls a selected rule title a “confirmed toxicity.” Report generation remains paused for manual clinical review.

| Source row | Treatment | Drug class | Source toxicity | Proposed confirmation |
| ---: | --- | --- | --- | --- |
| 2 | Chemotherapy (Cytotoxic) | Taxanes | Neutropenia / febrile neutropenia | Clinician confirmation |
| 3 | Chemotherapy (Cytotoxic) | Taxanes | Mucositis | Patient symptom: Gastrointestinal symptoms = Mouth Ulcers / Mucositis OR Symptoms = Mouth sores |
| 4 | Chemotherapy (Cytotoxic) | Taxanes | Peripheral neuropathy | Clinician confirmation |
| 5 | Chemotherapy (Cytotoxic) | Taxanes | Taste changes | Patient symptom: Gastrointestinal symptoms = Taste Changes (Dysgeusia) OR Symptoms = Things taste funny or have no taste |
| 6 | Chemotherapy (Cytotoxic) | Taxanes | Diarrhea (docetaxel, cabazitaxel) | Patient symptom: Symptoms = Diarrhoea |
| 7 | Chemotherapy (Cytotoxic) | Taxanes | Fluid retention (docetaxel) | Clinician confirmation |
| 8 | Chemotherapy (Cytotoxic) | Taxanes | Muscle and joint pain | Clinician confirmation |
| 9 | Chemotherapy (Cytotoxic) | Taxanes | Fatigue / reduced appetite | Any one: Symptoms = Fatigue OR Appetite status = Reduced / No Appetite OR Symptoms = No appetite |
| 10 | Chemotherapy (Cytotoxic) | Taxanes | Steroid premedication hyperglycemia | Clinician confirmation |
| 11 | Chemotherapy (Cytotoxic) | Taxanes | Nausea (mild) | Patient symptom: Gastrointestinal symptoms = Nausea OR Symptoms = Nausea |
| 12 | Chemotherapy (Cytotoxic) | Anthracyclines | Nausea and vomiting (moderate to high) | Any one: Gastrointestinal symptoms or Symptoms = Nausea / Vomiting; severity unconfirmed |
| 13 | Chemotherapy (Cytotoxic) | Anthracyclines | Mucositis | Patient symptom: Gastrointestinal symptoms = Mouth Ulcers / Mucositis OR Symptoms = Mouth sores |
| 14 | Chemotherapy (Cytotoxic) | Anthracyclines | Neutropenia / febrile neutropenia | Clinician confirmation |
| 15 | Chemotherapy (Cytotoxic) | Anthracyclines | Cardiotoxicity (cumulative) | Clinician confirmation |
| 16 | Chemotherapy (Cytotoxic) | Anthracyclines | Hand-foot syndrome (liposomal doxorubicin) | Clinician confirmation |
| 17 | Chemotherapy (Cytotoxic) | Anthracyclines | Constipation (from antiemetics) | Patient symptom: Symptoms = Constipation |
| 18 | Chemotherapy (Cytotoxic) | Anthracyclines | Fatigue | Patient symptom: Symptoms = Fatigue |
| 19 | Chemotherapy (Cytotoxic) | Anthracyclines | Red-orange urine (drug color, harmless for 1–2 days) | Clinician confirmation |
| 20 | Chemotherapy (Cytotoxic) | Alkylating agents | Nausea and vomiting | Any one: Gastrointestinal symptoms or Symptoms = Nausea / Vomiting |
| 21 | Chemotherapy (Cytotoxic) | Alkylating agents | Myelosuppression / infection risk | Clinician confirmation |
| 22 | Chemotherapy (Cytotoxic) | Alkylating agents | Mucositis (especially high-dose melphalan) | Patient symptom: Gastrointestinal symptoms = Mouth Ulcers / Mucositis OR Symptoms = Mouth sores |
| 23 | Chemotherapy (Cytotoxic) | Alkylating agents | Hemorrhagic cystitis (cyclophosphamide, ifosfamide) | Clinician confirmation |
| 24 | Chemotherapy (Cytotoxic) | Alkylating agents | Diarrhea (melphalan, busulfan) | Patient symptom: Symptoms = Diarrhoea |
| 25 | Chemotherapy (Cytotoxic) | Alkylating agents | Constipation (temozolomide) | Patient symptom: Symptoms = Constipation |
| 26 | Chemotherapy (Cytotoxic) | Alkylating agents | Taste changes / anorexia | Any one: taste change or reduced/no appetite |
| 27 | Chemotherapy (Cytotoxic) | Alkylating agents | Steroid hyperglycemia (when co-prescribed) | Clinician confirmation |
| 28 | Chemotherapy (Cytotoxic) | Alkylating agents | Fatigue | Patient symptom: Symptoms = Fatigue |
| 29 | Chemotherapy (Cytotoxic) | Platinum agents | Nausea and vomiting (high with cisplatin) | Any one: Gastrointestinal symptoms or Symptoms = Nausea / Vomiting; severity and drug unconfirmed |
| 30 | Chemotherapy (Cytotoxic) | Platinum agents | Dehydration | Clinician confirmation |
| 31 | Chemotherapy (Cytotoxic) | Platinum agents | Electrolyte loss (Mg, K, Na, Ca) | Clinician confirmation |
| 32 | Chemotherapy (Cytotoxic) | Platinum agents | Nephrotoxicity (cisplatin) | Clinician confirmation |
| 33 | Chemotherapy (Cytotoxic) | Platinum agents | Peripheral neuropathy | Clinician confirmation |
| 34 | Chemotherapy (Cytotoxic) | Platinum agents | Hearing change / tinnitus (cisplatin) | Clinician confirmation |
| 35 | Chemotherapy (Cytotoxic) | Platinum agents | Myelosuppression, anemia, low platelets (carboplatin) | Clinician confirmation |
| 36 | Chemotherapy (Cytotoxic) | Platinum agents | Taste changes | Patient symptom: Gastrointestinal symptoms = Taste Changes (Dysgeusia) OR Symptoms = Things taste funny or have no taste |
| 37 | Chemotherapy (Cytotoxic) | Platinum agents | Diarrhea / mild mucositis (oxaliplatin) | Clinician confirmation |
| 38 | Chemotherapy (Cytotoxic) | Antimetabolites | Mucositis / mouth blisters | Patient symptom: Gastrointestinal symptoms = Mouth Ulcers / Mucositis OR Symptoms = Mouth sores |
| 39 | Chemotherapy (Cytotoxic) | Antimetabolites | Diarrhea | Patient symptom: Symptoms = Diarrhoea |
| 40 | Chemotherapy (Cytotoxic) | Antimetabolites | Hand-foot syndrome (capecitabine, 5-FU) | Clinician confirmation |
| 41 | Chemotherapy (Cytotoxic) | Antimetabolites | Nausea and vomiting | Any one: Gastrointestinal symptoms or Symptoms = Nausea / Vomiting |
| 42 | Chemotherapy (Cytotoxic) | Antimetabolites | Myelosuppression / infection risk | Clinician confirmation |
| 43 | Chemotherapy (Cytotoxic) | Antimetabolites | Dehydration | Clinician confirmation |
| 44 | Chemotherapy (Cytotoxic) | Antimetabolites | Raised liver enzymes (gemcitabine, methotrexate) | Clinician confirmation |
| 45 | Chemotherapy (Cytotoxic) | Antimetabolites | Flu-like symptoms, fatigue, edema (gemcitabine) | Clinician confirmation |
| 46 | Chemotherapy (Cytotoxic) | Antimetabolites | Anemia (trifluridine/tipiracil, methotrexate) | Clinician confirmation |
| 47 | Chemotherapy (Cytotoxic) | Topoisomerase inhibitors | Early diarrhea (cholinergic, within 24 h) | Clinician confirmation |
| 48 | Chemotherapy (Cytotoxic) | Topoisomerase inhibitors | Late diarrhea (can be severe) | Clinician confirmation |
| 49 | Chemotherapy (Cytotoxic) | Topoisomerase inhibitors | Neutropenia / febrile neutropenia | Clinician confirmation |
| 50 | Chemotherapy (Cytotoxic) | Topoisomerase inhibitors | Nausea and vomiting | Any one: Gastrointestinal symptoms or Symptoms = Nausea / Vomiting |
| 51 | Chemotherapy (Cytotoxic) | Topoisomerase inhibitors | Dehydration and electrolyte loss | Clinician confirmation |
| 52 | Chemotherapy (Cytotoxic) | Topoisomerase inhibitors | Mucositis (etoposide, topotecan) | Patient symptom: Gastrointestinal symptoms = Mouth Ulcers / Mucositis OR Symptoms = Mouth sores |
| 53 | Chemotherapy (Cytotoxic) | Topoisomerase inhibitors | Anorexia / fatigue | Any one: Fatigue or reduced/no appetite |
| 54 | Chemotherapy (Cytotoxic) | Topoisomerase inhibitors | Anemia (topotecan) | Clinician confirmation |
| 55 | Chemotherapy (Cytotoxic) | Vinca alkaloids | Constipation / ileus (vincristine) | Clinician confirmation |
| 56 | Chemotherapy (Cytotoxic) | Vinca alkaloids | Peripheral neuropathy | Clinician confirmation |
| 57 | Chemotherapy (Cytotoxic) | Vinca alkaloids | Jaw pain | Clinician confirmation |
| 58 | Chemotherapy (Cytotoxic) | Vinca alkaloids | Neutropenia (vinorelbine, vinblastine) | Clinician confirmation |
| 59 | Chemotherapy (Cytotoxic) | Vinca alkaloids | Nausea (mild) | Patient symptom: Gastrointestinal symptoms = Nausea OR Symptoms = Nausea |
| 60 | Chemotherapy (Cytotoxic) | Vinca alkaloids | Mucositis | Patient symptom: Gastrointestinal symptoms = Mouth Ulcers / Mucositis OR Symptoms = Mouth sores |
| 61 | Chemotherapy (Cytotoxic) | Vinca alkaloids | Low sodium (SIADH, rare) | Clinician confirmation |
| 62 | Targeted Therapy | Tyrosine kinase inhibitors | Diarrhea (EGFR TKIs, lapatinib, regorafenib, cabozantinib) | Patient symptom: Symptoms = Diarrhoea |
| 63 | Targeted Therapy | Tyrosine kinase inhibitors | Rash, dry skin, mouth sores | Clinician confirmation |
| 64 | Targeted Therapy | Tyrosine kinase inhibitors | Hypertension (VEGF TKIs) | Clinician confirmation |
| 65 | Targeted Therapy | Tyrosine kinase inhibitors | Hand-foot skin reaction (sorafenib, sunitinib, regorafenib) | Clinician confirmation |
| 66 | Targeted Therapy | Tyrosine kinase inhibitors | Fatigue / anorexia / weight loss | Any one: Fatigue or reduced/no appetite; weight loss unconfirmed |
| 67 | Targeted Therapy | Tyrosine kinase inhibitors | Taste changes | Patient symptom: Gastrointestinal symptoms = Taste Changes (Dysgeusia) OR Symptoms = Things taste funny or have no taste |
| 68 | Targeted Therapy | Tyrosine kinase inhibitors | Nausea | Patient symptom: Gastrointestinal symptoms = Nausea OR Symptoms = Nausea |
| 69 | Targeted Therapy | Tyrosine kinase inhibitors | Edema (imatinib) | Clinician confirmation |
| 70 | Targeted Therapy | Tyrosine kinase inhibitors | Raised liver enzymes | Clinician confirmation |
| 71 | Targeted Therapy | Tyrosine kinase inhibitors | Hypothyroidism (e.g., sunitinib) | Clinician confirmation |
| 72 | Targeted Therapy | Tyrosine kinase inhibitors | Hyperglycemia | Clinician confirmation |
| 73 | Targeted Therapy | Tyrosine kinase inhibitors | Low calcium / phosphate (imatinib) | Clinician confirmation |
| 74 | Targeted Therapy | Tyrosine kinase inhibitors | QT prolongation (nilotinib) | Clinician confirmation |
| 75 | Targeted Therapy | PARP inhibitors | Nausea and vomiting | Any one: Gastrointestinal symptoms or Symptoms = Nausea / Vomiting |
| 76 | Targeted Therapy | PARP inhibitors | Reduced appetite / taste changes | Any one: reduced/no appetite or taste change |
| 77 | Targeted Therapy | PARP inhibitors | Fatigue | Patient symptom: Symptoms = Fatigue |
| 78 | Targeted Therapy | PARP inhibitors | Anemia (common; may need transfusion) | Clinician confirmation |
| 79 | Targeted Therapy | PARP inhibitors | Low platelets / neutropenia | Clinician confirmation |
| 80 | Targeted Therapy | PARP inhibitors | Constipation or diarrhea | Clinician confirmation |
| 81 | Targeted Therapy | PARP inhibitors | Hypertension (niraparib) | Clinician confirmation |
| 82 | Targeted Therapy | HER2-targeted antibodies | Diarrhea (especially pertuzumab) | Patient symptom: Symptoms = Diarrhoea |
| 83 | Targeted Therapy | HER2-targeted antibodies | Nausea and vomiting (notably T-DXd) | Any one: Gastrointestinal symptoms or Symptoms = Nausea / Vomiting; named drug unconfirmed |
| 84 | Targeted Therapy | HER2-targeted antibodies | Cardiotoxicity | Clinician confirmation |
| 85 | Targeted Therapy | HER2-targeted antibodies | Infusion-related chills / fever | Clinician confirmation |
| 86 | Targeted Therapy | HER2-targeted antibodies | Fatigue / reduced appetite | Any one: Symptoms = Fatigue OR Appetite status = Reduced / No Appetite OR Symptoms = No appetite |
| 87 | Targeted Therapy | HER2-targeted antibodies | Mouth sores | Patient symptom: Gastrointestinal symptoms = Mouth Ulcers / Mucositis OR Symptoms = Mouth sores |
| 88 | Targeted Therapy | HER2-targeted antibodies | Raised liver enzymes, low platelets (T-DM1) | Clinician confirmation |
| 89 | Targeted Therapy | HER2-targeted antibodies | Neuropathy (T-DM1) | Clinician confirmation |
| 90 | Targeted Therapy | HER2-targeted antibodies | Neutropenia (T-DXd) | Clinician confirmation |
| 91 | Targeted Therapy | CD20 monoclonal antibodies | Infusion reactions | Clinician confirmation |
| 92 | Targeted Therapy | CD20 monoclonal antibodies | Infection risk (late neutropenia, low immunoglobulins) | Clinician confirmation |
| 93 | Targeted Therapy | CD20 monoclonal antibodies | Tumor lysis syndrome (first doses, high tumor burden) | Clinician confirmation |
| 94 | Targeted Therapy | CD20 monoclonal antibodies | Nausea (mild) | Patient symptom: Gastrointestinal symptoms = Nausea OR Symptoms = Nausea |
| 95 | Targeted Therapy | CD20 monoclonal antibodies | Fatigue | Patient symptom: Symptoms = Fatigue |
| 96 | Targeted Therapy | CD20 monoclonal antibodies | Diarrhea | Patient symptom: Symptoms = Diarrhoea |
| 97 | Immunotherapy | Immune checkpoint inhibitors | Immune-related diarrhea / colitis | Clinician confirmation |
| 98 | Immunotherapy | Immune checkpoint inhibitors | Hepatitis | Clinician confirmation |
| 99 | Immunotherapy | Immune checkpoint inhibitors | Thyroid dysfunction (hypo- or hyperthyroid) | Clinician confirmation |
| 100 | Immunotherapy | Immune checkpoint inhibitors | New hyperglycemia / diabetes (can be sudden) | Clinician confirmation |
| 101 | Immunotherapy | Immune checkpoint inhibitors | Adrenal / pituitary insufficiency | Clinician confirmation |
| 102 | Immunotherapy | Immune checkpoint inhibitors | Rash / itching | Clinician confirmation |
| 103 | Immunotherapy | Immune checkpoint inhibitors | Fatigue / reduced appetite | Any one: Symptoms = Fatigue OR Appetite status = Reduced / No Appetite OR Symptoms = No appetite |
| 104 | Immunotherapy | Immune checkpoint inhibitors | Joint and muscle pain | Clinician confirmation |
| 105 | Immunotherapy | Immune checkpoint inhibitors | Steroid treatment for immune-related events | Clinician confirmation |
| 106 | Hormonal Therapy | Anti-estrogens / SERMs | Hot flashes | Clinician confirmation |
| 107 | Hormonal Therapy | Anti-estrogens / SERMs | Weight gain | Measured weight gain: current > previous |
| 108 | Hormonal Therapy | Anti-estrogens / SERMs | High triglycerides / lipids | Clinician confirmation |
| 109 | Hormonal Therapy | Anti-estrogens / SERMs | Fatty liver / raised liver enzymes | Clinician confirmation |
| 110 | Hormonal Therapy | Anti-estrogens / SERMs | Increased clot risk | Clinician confirmation |
| 111 | Hormonal Therapy | Anti-estrogens / SERMs | Joint pain / injection-site pain (fulvestrant) | Clinician confirmation |
| 112 | Hormonal Therapy | Anti-estrogens / SERMs | Bone health (premenopausal) | Clinician confirmation |
| 113 | Hormonal Therapy | Anti-estrogens / SERMs | Nausea (mild) | Patient symptom: Gastrointestinal symptoms = Nausea OR Symptoms = Nausea |
| 114 | Hormonal Therapy | Aromatase inhibitors | Bone loss / osteoporosis | Clinician confirmation |
| 115 | Hormonal Therapy | Aromatase inhibitors | Joint pain and stiffness | Clinician confirmation |
| 116 | Hormonal Therapy | Aromatase inhibitors | Hot flashes | Clinician confirmation |
| 117 | Hormonal Therapy | Aromatase inhibitors | High cholesterol | Clinician confirmation |
| 118 | Hormonal Therapy | Aromatase inhibitors | Weight gain | Measured weight gain: current > previous |
| 119 | Hormonal Therapy | Aromatase inhibitors | Fatigue | Patient symptom: Symptoms = Fatigue |
| 120 | Hormonal Therapy | Anti-androgens / androgen deprivation therapy | Hot flashes | Clinician confirmation |
| 121 | Hormonal Therapy | Anti-androgens / androgen deprivation therapy | Muscle loss and fat gain | Clinician confirmation |
| 122 | Hormonal Therapy | Anti-androgens / androgen deprivation therapy | Weight gain | Measured weight gain: current > previous |
| 123 | Hormonal Therapy | Anti-androgens / androgen deprivation therapy | Insulin resistance / hyperglycemia | Clinician confirmation |
| 124 | Hormonal Therapy | Anti-androgens / androgen deprivation therapy | Dyslipidemia and cardiovascular risk | Clinician confirmation |
| 125 | Hormonal Therapy | Anti-androgens / androgen deprivation therapy | Bone loss | Clinician confirmation |
| 126 | Hormonal Therapy | Anti-androgens / androgen deprivation therapy | Fatigue / reduced appetite / diarrhea | Clinician confirmation |
| 127 | Hormonal Therapy | Anti-androgens / androgen deprivation therapy | Liver toxicity (bicalutamide, abiraterone) | Clinician confirmation |
| 128 | Hormonal Therapy | Anti-androgens / androgen deprivation therapy | Hypertension, fluid retention, low potassium (abiraterone with prednisone) | Clinician confirmation |
| 129 | Targeted Therapy | CDK4/6 inhibitors | Neutropenia (palbociclib, ribociclib) | Clinician confirmation |
| 130 | Targeted Therapy | CDK4/6 inhibitors | Diarrhea (most notable with abemaciclib) | Patient symptom: Symptoms = Diarrhoea |
| 131 | Targeted Therapy | CDK4/6 inhibitors | Nausea and vomiting | Any one: Gastrointestinal symptoms or Symptoms = Nausea / Vomiting |
| 132 | Targeted Therapy | CDK4/6 inhibitors | Mouth sores | Patient symptom: Gastrointestinal symptoms = Mouth Ulcers / Mucositis OR Symptoms = Mouth sores |
| 133 | Targeted Therapy | CDK4/6 inhibitors | Fatigue / reduced appetite | Any one: Symptoms = Fatigue OR Appetite status = Reduced / No Appetite OR Symptoms = No appetite |
| 134 | Targeted Therapy | CDK4/6 inhibitors | Anemia | Clinician confirmation |
| 135 | Targeted Therapy | CDK4/6 inhibitors | Raised liver enzymes | Clinician confirmation |
| 136 | Targeted Therapy | CDK4/6 inhibitors | QT prolongation (ribociclib) | Clinician confirmation |
| 137 | Targeted Therapy | CDK4/6 inhibitors | Raised creatinine (abemaciclib; usually not true kidney injury) | Clinician confirmation |

Review outcome: pending clinical sign-off for the remaining combined and clinical rows. Continue report matching only after the chosen mappings and patient-facing wording have been manually approved.
