import { blankRuleDefinition, ruleDefinitionSchema, type RuleDefinition, type RuleQuestion } from "./rule-definition";

const document = "NIQ Assessment  Scoring sheet.xlsx";
const source = (location: string, note = "") => ({ document, location, note });
const master = (rows: string, note = "") => source(`NIQ master question sheet!${rows}`, note);

/** Fixed workbook fields and sourced points; unresolved clinical mappings still block approval. */
export function createSpreadsheetTemplate(name: string): RuleDefinition {
  const definition = blankRuleDefinition(name);
  definition.description = "Fixed questionnaire and scoring defaults from the NIQ assessment workbook. Assign scoring domains and resolve the remaining source questions before approval. No patient data is included.";
  const sections = definition.sections;
  const section = (id: string, title: string, description = "") => {
    const value: RuleDefinition["sections"][number] = { id, title, description, questions: [] };
    sections.push(value);
    return value.questions;
  };
  const question = (target: RuleQuestion[], id: string, label: string, type: RuleQuestion["type"], rows: string, extra: Partial<RuleQuestion> = {}) => {
    const value: RuleQuestion = { id, label, type, purpose: "assessment", help: "", unit: "", required: false, options: [], validation: {}, visibleWhen: null, sources: [master(rows)], ...extra };
    target.push(value);
    return value;
  };
  const choose = (target: RuleQuestion[], id: string, label: string, rows: string, choices: [string, string][], points = "", multiple = false, purpose: RuleQuestion["purpose"] = "scoring") => question(target, id, label, multiple ? "multi_select" : "single_select", rows, {
    purpose, options: choices.map(([key, text]) => ({ id: `${id}_${key}`, label: text, help: "" })),
    sources: [master(rows, points)],
  });
  const text = (target: RuleQuestion[], id: string, label: string, rows: string, long = false) => question(target, id, label, long ? "long_text" : "text", rows);
  const number = (target: RuleQuestion[], id: string, label: string, rows: string, unit = "") => question(target, id, label, "number", rows, { unit, validation: { min: 0 } });
  const date = (target: RuleQuestion[], id: string, label: string, rows: string) => question(target, id, label, "date", rows);
  const selected = (q: RuleQuestion, parent: string, value: string, multiple = false) => {
    q.visibleWhen = { match: "all", tests: [{ ref: { kind: "question", id: parent }, operator: multiple ? "includes" : "eq", value: `${parent}_${value}` }] };
  };
  const details = section("patient_details", "Basic patient details", "Assessment fields only; NIQ Scoring does not persist patient records from preview.");
  text(details, "patient_name", "Name", "A5:A8");
  number(details, "age", "Age", "A6", "years");
  text(details, "gender", "Gender", "A6");
  text(details, "contact", "Contact", "A7");
  number(details, "height_cm", "Height", "A8", "cm");
  number(details, "weight_kg", "Current weight", "A8; A151", "kg");

  const diagnosis = section("diagnosis", "Cancer diagnosis");
  choose(diagnosis, "tumour_type", "Type of tumour", "A11:B11", [["solid", "Solid tumour"], ["haematological", "Haematological"]], "Solid: 2; haematological: 1.");
  choose(diagnosis, "tumour_behaviour", "Tumour behaviour", "A12:B13", [["benign", "Benign (non-cancerous, does not spread)"], ["malignant", "Malignant (cancer, can spread to other parts)"]], "Benign: 0; malignant: 2.");
  choose(diagnosis, "tumour_origin", "Tumour origin", "A14:B15", [["primary", "Primary tumour (started in this organ)"], ["secondary", "Metastatic / Secondary (spread from another part of body)"]], "Primary: 1; metastatic / secondary: 3.");
  choose(diagnosis, "cancer_type", "Type of cancer", "A16:A39", [
    ["breast", "Breast cancer"], ["lung", "Lung cancer"], ["colorectal", "Colon / Rectal cancer"], ["stomach", "Stomach cancer"], ["liver", "Liver cancer"], ["pancreatic", "Pancreatic cancer"], ["head_neck", "Head & Neck cancer"], ["brain", "Brain tumour"], ["ovarian", "Ovarian cancer"], ["uterine", "Uterine cancer"], ["cervical", "Cervical cancer"], ["prostate", "Prostate cancer"], ["testicular", "Testicular cancer"], ["kidney", "Kidney cancer"], ["bladder", "Bladder cancer"], ["bone", "Bone cancer"], ["soft_tissue", "Soft tissue cancer"], ["leukaemia", "Blood cancer / Leukaemia"], ["lymphoma", "Lymphoma"], ["myeloma", "Myeloma"], ["skin", "Skin cancer"], ["other", "Other"], ["unknown", "Not sure / don’t know"],
  ]);
  selected(text(diagnosis, "cancer_other", "Other cancer", "A38"), "cancer_type", "other");
  choose(diagnosis, "cancer_stage", "Stage", "A40:B43", [["localized", "Localized (stage 1–2)"], ["locally_advanced", "Locally Advanced (stage 3)"], ["metastatic", "Metastatic (stage 4)"]], "Localized: 1; locally advanced: 2; metastatic: 3.");
  question(diagnosis, "has_metastasis", "Metastasis present?", "boolean", "A44:A48", { sources: [master("A44:A48"), source("Assessment!B6:C6")] });
  const sites = choose(diagnosis, "metastasis_sites", "Metastasis sites", "A44:A48", [["brain", "Brain"], ["liver", "Liver"], ["lung", "Lung"], ["other", "Others"]], "", true);
  sites.visibleWhen = { match: "all", tests: [{ ref: { kind: "question", id: "has_metastasis" }, operator: "eq", value: true }] };
  selected(text(diagnosis, "metastasis_other", "Other metastasis site", "A48"), "metastasis_sites", "other", true);

  const history = section("medical_history", "Treatment status and medical history");
  choose(history, "treatment_status", "Treatment status", "A49:B53", [["new", "Newly Diagnosed"], ["under", "Under Treatment"], ["post", "Post-Treatment"], ["palliative", "Palliative Care"]], "New: 0; under treatment: 2; post-treatment: 1. Palliative/post-treatment wording requires confirmation: without cancer within 6 months 3, within 12 months 2, after 12 months 1; with cancer any stage 3.");
  choose(history, "surgery_status", "Cancer surgical status", "A54:B58", [["done", "Surgery Done"], ["planned", "Planned"], ["not_required", "Not Required"], ["not_fit", "Not Fit for Surgery"]], "Done: 1; planned: 2; not required: 0; not fit: 3.");
  selected(date(history, "surgery_date", "Surgery date", "A55"), "surgery_status", "done");
  selected(date(history, "planned_surgery_date", "Planned surgery date", "A56"), "surgery_status", "planned");
  choose(history, "relapse_status", "Relapse status", "A59:B62", [["first", "First Diagnosis"], ["relapsed", "Relapsed"], ["refractory", "Refractory"]], "First diagnosis: 0; relapsed: 1; refractory: 2.");
  choose(history, "comorbidities", "Co-morbidities (chronic / surgical)", "A63:B70", [["diabetes", "Diabetes"], ["hypertension", "Hypertension"], ["thyroid", "Thyroid Disorder"], ["kidney", "Kidney Disease"], ["liver", "Liver Disease"], ["cardiac", "Cardiac Disease"], ["other", "Others"]], "None: 0; present: 1. Confirm explicit none-answer representation.", true);
  selected(text(history, "comorbidity_details", "Other co-morbidity", "A70"), "comorbidities", "other", true);
  text(history, "previous_surgeries", "Any previous surgeries", "A71:B74", true);
  date(history, "previous_surgery_date", "Previous surgery date", "A73");
  text(history, "long_term_illness", "Any long-term illness", "A74:B74", true);
  date(history, "illness_since", "Illness since", "A75");
  question(history, "family_cancer", "Family history of cancer?", "boolean", "A76:B78", { purpose: "scoring", sources: [master("A76:B78", "Yes: 1; no: 0.")] });
  const relation = text(history, "family_relation", "Relation", "A77");
  relation.visibleWhen = { match: "all", tests: [{ ref: { kind: "question", id: "family_cancer" }, operator: "eq", value: true }] };

  const gut = section("gut_symptoms", "Gut and symptom evaluation");
  choose(gut, "appetite", "Appetite status", "A80:B83", [["normal", "Normal"], ["reduced", "Reduced"], ["none", "No Appetite"]], "Normal: 0; reduced: 2; no appetite: 3.");
  choose(gut, "gi_symptoms", "Gastrointestinal symptoms", "A84:B93", [["bloating", "Bloating"], ["reflux", "Acidity / Reflux"], ["nausea", "Nausea"], ["vomiting", "Vomiting"], ["satiety", "Early Satiety"], ["taste", "Taste Changes (Dysgeusia)"], ["dysphagia", "Dysphagia"], ["pain", "Pain while eating"], ["ulcers", "Mouth Ulcers / Mucositis"]], "Each symptom +1; maximum 6 in master sheet, absent from Assessment tab.", true);
  choose(gut, "bowel_pattern", "Bowel pattern", "A94:B98", [["normal", "Normal"], ["constipation", "Constipation"], ["diarrhoea", "Diarrhoea"], ["alternating", "Alternating"]], "0, 1, 1, 2 respectively.");
  choose(gut, "stool_frequency", "Stool frequency", "A99:B102", [["daily", "Daily"], ["below_three", "< 3 times/week"], ["above_three", "> 3 times/week"]], "0, 1, 2 respectively. Categories overlap and omit exactly 3 times/week.");
  question(gut, "has_intolerance", "Food intolerance / allergy present?", "boolean", "A103:B106", { sources: [master("A103:B106"), source("Assessment!B18:D18")] });
  const intolerance = choose(gut, "intolerances", "Food intolerance / allergy", "A103:B106", [["lactose", "Lactose intolerance"], ["gluten", "Gluten sensitivity"], ["specific", "Specific food allergy"]], "None: 0; present: 1.", true);
  intolerance.visibleWhen = { match: "all", tests: [{ ref: { kind: "question", id: "has_intolerance" }, operator: "eq", value: true }] };
  selected(text(gut, "allergy_details", "Specific food allergy", "A106"), "intolerances", "specific", true);
  text(gut, "food_likes", "Food likes", "A108", true);
  text(gut, "food_dislikes", "Food dislikes", "A109", true);
  choose(gut, "diet_preference", "Diet preference", "A110:B110", [["vegetarian", "Vegetarian"], ["non_vegetarian", "Non-vegetarian"], ["eggetarian", "Eggetarian"], ["jain", "Jain"]], "", false, "assessment");
  choose(gut, "microbiota_test", "Gut microbiota test", "A111", [["required", "Required"], ["not_required", "Not Required"], ["awaiting", "Sample given, awaiting results"], ["done", "Report done"]], "", false, "clinician");

  const labs = section("biomedical", "Biomedical parameters", "Manual entry only. Report upload and automatic extraction are deferred; units and scoring thresholds require confirmation.");
  for (const [id, label, rows] of [["haemoglobin", "Haemoglobin", "A113:B113"], ["sgpt", "SGPT", "A114:B114"], ["sgot", "SGOT", "A115"], ["albumin", "Serum albumin", "A116:B116"], ["creatinine", "Serum creatinine", "A117:B117"], ["crp", "C-reactive protein", "A118:B118"]]) {
    const q = number(labs, id!, label!, rows!); q.purpose = "scoring"; q.sources.push(source("Assessment!B25:D25", "Required parameters; scoring needs confirmation."));
  }
  for (const [id, label] of [["bilirubin", "Total bilirubin"], ["total_proteins", "Total proteins"]]) question(labs, id!, label!, "number", "A112:A118", { purpose: "scoring", validation: { min: 0 }, sources: [source("Assessment!B25:D25")] });

  const medications = section("treatment_medications", "Current treatment and medications");
  choose(medications, "current_treatment", "Current cancer treatment", "A120:B126", [["chemo", "Chemotherapy (Cytotoxic)"], ["immuno", "Immunotherapy"], ["radiation", "Radiation Therapy"], ["targeted", "Targeted Therapy"], ["hormonal", "Hormonal Therapy"], ["other", "Other treatment"]], "3, 2, 1, 1, 1, 1 respectively; confirm combined-treatment aggregation.", true);
  selected(text(medications, "treatment_other", "Other treatment details", "A126"), "current_treatment", "other", true);
  number(medications, "cycle_number", "Cycle number", "A128");
  text(medications, "cycle_frequency", "Treatment frequency", "A129");
  choose(medications, "medications", "Current medications", "A130:B139", [["blood_thinners", "Blood Thinners"], ["antihypertensive", "Anti-hypertensives (BP meds)"], ["antidiabetic", "Anti-diabetics"], ["hypothyroid", "Hypothyroid"], ["cholesterol", "Cholesterols"], ["steroids", "Steroids"], ["antihistamine", "Anti-histamines"], ["pain", "Pain medications"], ["antibiotics", "Antibiotics"]], "Each medication or supplement +1; counting and caps require confirmation.", true);
  choose(medications, "supplements", "Supplements intake", "A140:A147", [["protein", "Protein supplements"], ["iron", "Iron"], ["calcium", "Calcium"], ["folic_acid", "Folic Acid"], ["multivitamins", "Multivitamins"], ["omega_three", "Omega-3"], ["other", "Others"]], "Each medication or supplement +1; counting and caps require confirmation.", true);
  selected(text(medications, "supplement_details", "Other supplements", "A147"), "supplements", "other", true);

  const diet = section("dietary_assessment", "Dietary assessment", "Based on the supplied PG-SGA / SGA-aligned worksheet; no external scoring model is assumed.");
  number(diet, "weight_one_month", "Weight one month ago", "A151", "kg");
  number(diet, "weight_six_months", "Weight six months ago", "A151", "kg");
  choose(diet, "weight_loss_category", "Weight loss category", "A152:B156", [["none", "None"], ["mild", "Mild (<5%)"], ["moderate", "Moderate (5–10%)"], ["severe", "Severe (>10%)"]], "0, 1, 2, 3 respectively. Final category must use an agreed baseline; manual category is provisional.");
  choose(diet, "dietary_intake", "Food intake compared with normal during the past month", "A157:A164", [["normal", "Normal Intake"], ["more", "More than usual"], ["reduced", "Reduced Intake / less than usual"], ["liquid", "Liquid Diet"], ["little_solid", "Little solid food"], ["tube", "Tube Feeding"]]);
  choose(diet, "dietary_symptoms", "Symptoms affecting intake", "A165:B182", [["none", "No problem while eating"], ["appetite", "No appetite, just did not feel like eating"], ["nausea", "Nausea"], ["vomiting", "Vomiting"], ["constipation", "Constipation"], ["diarrhoea", "Diarrhoea"], ["mouth_sores", "Mouth sores"], ["dry_mouth", "Dry mouth"], ["taste", "Things taste funny or have no taste"], ["smells", "Smells bother me"], ["swallowing", "Problems while swallowing"], ["satiety", "Feel full quickly"], ["pain", "Any pain"], ["fatigue", "Fatigue"], ["muscle_loss", "Muscle loss"], ["other", "Other"]], "In listed order: 0, 3, 1, 3, 1, 3, 2, 1, 1, 1, 2, 1, 3, 1, 3, 1. Overlap with GI symptoms and aggregation require confirmation.", true);
  selected(text(diet, "pain_location", "Where is the pain?", "A178"), "dietary_symptoms", "pain", true);
  selected(text(diet, "symptom_other", "Other symptom (for example depression, money, or dental problems)", "A181:A182", true), "dietary_symptoms", "other", true);
  choose(diet, "functional_capacity", "Functional capacity", "A183:B186", [["normal", "Normal Activity"], ["reduced", "Reduced Activity"], ["bedridden", "Bedridden"]], "Master: 0/1/2; Assessment tab: 1/2/3. Needs confirmation.");
  choose(diet, "stress", "Stress level", "A187:B188", [["high", "High"], ["moderate", "Moderate"], ["low", "None / Low"]], "High: 2; moderate: 1; none/low: 0.");
  number(diet, "meals_per_day", "Number of meals per day", "A189:A190");
  for (const [id, label, rows] of [["breakfast", "Breakfast", "A192"], ["lunch", "Lunch", "A193"], ["snacks", "Snacks", "A194"], ["dinner", "Dinner", "A195"], ["recall_other", "Other diet recall details", "A196"]]) text(diet, id!, `${label} (24-hour recall)`, rows!, true);
  choose(diet, "protein_intake", "Protein intake", "A197:B199", [["adequate", "Adequate"], ["inadequate", "Inadequate"]], "Adequate: 0; inadequate: 1.");
  choose(diet, "fluid_intake", "Fluid intake", "A200:B203", [["below_one", "<1 liter"], ["one_two", "1–2 liters"], ["above_two", ">2 liters"]], "3, 2, 1 respectively.");

  const clinician = section("clinician_assessment", "Dietitian assessment and guidance", "Clinician-entered fields are distinct from automatically generated recommendations.");
  choose(clinician, "nutrition_assessment", "Clinical assessment by dietitian", "A204:A207", [["well", "Well nourished"], ["moderate", "Moderately malnourished"], ["severe", "Severely malnourished"]], "", false, "clinician");
  const sga = number(clinician, "sga_score", "SGA total score", "A208:A209"); sga.purpose = "clinician"; sga.sources = [master("A208:A209", "Source states ≥6 indicates risk of malnutrition; calculation and relationship to NIQ total require confirmation.")];
  choose(clinician, "nutrition_goals", "Nutrition therapy goals / recommendations", "A210:A215", [["gain_weight", "Gain Weight"], ["maintain_status", "Maintain Present Nutritional Status"], ["improve_status", "Improve Nutritional Status"], ["prevent_infection", "Prevent Infection / Sepsis"], ["rehydration", "Maintain Rehydration"], ["blood_values", "Maintain Normal Blood Values"], ["recovery", "Ensure Speedy Recovery"], ["supplementation", "Provide Appropriate Nutritional Supplementation"]], "", true, "clinician");
  text(clinician, "dietary_regime", "Advised dietary regime (treatment-specific interventions)", "A216", true).purpose = "clinician";
  text(clinician, "remarks", "Remarks / Notes", "A217", true).purpose = "clinician";
  text(clinician, "clinician_signature", "Clinician name / signature", "A218").purpose = "clinician";
  date(clinician, "clinical_date", "Clinical assessment date", "A218").purpose = "clinician";

  definition.calculations = [
    { id: "bmi", label: "BMI", unit: "kg/m²", operation: "bmi", operands: [{ kind: "question", id: "weight_kg" }, { kind: "question", id: "height_cm" }], precision: 2, sources: [master("A8"), source("Assessment!C2")] },
    { id: "weight_change_one_month", label: "Weight change from one month ago", unit: "%", operation: "percentage_change", operands: [{ kind: "question", id: "weight_one_month" }, { kind: "question", id: "weight_kg" }], precision: 2, sources: [master("A151:A156"), source("Assessment!C20", "Baseline for final weight-loss scoring requires confirmation.")] },
    { id: "weight_change_six_months", label: "Weight change from six months ago", unit: "%", operation: "percentage_change", operands: [{ kind: "question", id: "weight_six_months" }, { kind: "question", id: "weight_kg" }], precision: 2, sources: [master("A151:A156"), source("Assessment!C20", "Baseline for final weight-loss scoring requires confirmation.")] },
  ];
  definition.domains = [["disease", "Disease", 5, "D4:F4"], ["clinical", "Clinical", 10, "D6:F6"], ["history", "History", 5, "D8:F8"], ["treatment", "Treatment", 5, "D10:F10"], ["nutrition", "Nutrition", 10, "D12:F12"]].map(([id, label, cap, row]) => ({ id: id as string, label: label as string, cap: cap as number, sources: [master(row as string)] }));
  // A technical placeholder avoids inventing a clinical domain assignment.
  definition.domains.push({ id: "unassigned", label: "Choose a scoring domain", cap: null, sources: [] });
  const questions = sections.flatMap(section => section.questions);
  const optionScores = (questionId: string, values: number[], rows: string, aggregation: "sum" | "max" = "sum", cap: number | null = null) => {
    const q = questions.find(question => question.id === questionId)!;
    definition.scoring.push({ id: `${questionId}_score`, label: q.label, domainId: "unassigned", kind: "options", questionId, aggregation, cap,
      points: values.map((points, index) => ({ optionId: q.options[index]!.id, points })), sources: [master(rows)] });
  };
  optionScores("tumour_type", [2, 1], "A11:B11");
  optionScores("tumour_behaviour", [0, 2], "A12:B13");
  optionScores("tumour_origin", [1, 3], "A14:B15");
  optionScores("cancer_stage", [1, 2, 3], "A41:B43");
  // Palliative scoring has conditional time windows, so its missing points stay
  // explicit and validation blocks approval rather than treating them as zero.
  optionScores("treatment_status", [0, 2, 1], "A50:B53");
  optionScores("surgery_status", [1, 2, 0, 3], "A55:B58");
  optionScores("relapse_status", [0, 1, 2], "A60:B62");
  optionScores("comorbidities", Array(7).fill(1), "A63:B70", "max");
  optionScores("appetite", [0, 2, 3], "A81:B83");
  optionScores("gi_symptoms", Array(9).fill(1), "A85:B93", "sum", 6);
  optionScores("bowel_pattern", [0, 1, 1, 2], "A95:B98");
  optionScores("stool_frequency", [0, 1, 2], "A100:B102");
  optionScores("current_treatment", [3, 2, 1, 1, 1, 1], "A121:B126");
  optionScores("medications", Array(9).fill(1), "A130:B139");
  optionScores("supplements", Array(7).fill(1), "A140:A147; B132");
  optionScores("weight_loss_category", [0, 1, 2, 3], "A153:B156");
  optionScores("dietary_symptoms", [0, 3, 1, 3, 1, 3, 2, 1, 1, 1, 2, 1, 3, 1, 3, 1], "A166:B181");
  optionScores("functional_capacity", [0, 1, 2], "A184:B186");
  optionScores("stress", [2, 1, 0], "A188:B188");
  optionScores("protein_intake", [0, 1], "A198:B199");
  optionScores("fluid_intake", [3, 2, 1], "A201:B203");
  for (const [questionId, rows] of [["family_cancer", "A76:B78"], ["has_intolerance", "A103:B106"]]) {
    const q = questions.find(question => question.id === questionId)!;
    q.purpose = "scoring";
    definition.scoring.push({ id: `${questionId}_score`, label: q.label, domainId: "unassigned", kind: "condition",
      when: { match: "all", tests: [{ ref: { kind: "question", id: questionId! }, operator: "eq", value: true }] }, points: 1, otherwise: 0, sources: [master(rows!)] });
  }
  for (const [questionId, threshold, rows] of [["creatinine", 1.4, "A117:B117"], ["crp", 10, "A118:B118"]] as const) {
    const q = questions.find(question => question.id === questionId)!;
    // Preserve the workbook's strict below/above wording. The uncovered equality
    // is a blocking RANGE_GAP until its clinical interpretation is confirmed.
    definition.scoring.push({ id: `${questionId}_score`, label: q.label, domainId: "unassigned", kind: "ranges",
      input: { kind: "question", id: questionId }, sources: [master(rows, "Units and scoring at the exact threshold are unspecified.")],
      bands: [
        { id: `${questionId}_below`, min: null, max: threshold, minInclusive: false, maxInclusive: false, points: 1 },
        { id: `${questionId}_above`, min: threshold, max: null, minInclusive: false, maxInclusive: false, points: 2 },
      ] });
  }
  definition.total = { aggregation: "sum", cap: 35, precision: 0 };
  definition.classifications = [
    { id: "low_risk", label: "Low Risk", min: 0, max: 15, minInclusive: true, maxInclusive: true, interpretation: "Stable nutritional status", sources: [master("D19:F19")] },
    { id: "moderate_risk", label: "Moderate Risk", min: 16, max: 25, minInclusive: true, maxInclusive: true, interpretation: "At risk of malnutrition / early inflammation", sources: [master("D20:F20")] },
    { id: "high_risk", label: "High Risk", min: 25, max: null, minInclusive: false, maxInclusive: false, interpretation: "Severe nutritional risk / active catabolism", sources: [master("D21:F21")] },
  ];
  const issue = (id: string, path: string, message: string, sources: RuleDefinition["issues"][number]["sources"]) => definition.issues.push({ id, path, message, blocking: true, resolved: false, resolution: "", sources });
  issue("domain_mapping", "scoring", "Assign each source-derived score to a workbook domain. The workbook supplies domain caps but no question-to-domain mapping. Unassigned is a technical placeholder, not a clinical domain.", [master("D4:F14")]);
  issue("model_difference", "total", "The workbook uses 35 points and three risk categories; the reference prototype uses a different 100-point model. Confirm the authoritative model and cap semantics.", [master("D4:F21"), { document: "nutra-iq-app", location: "src/app/services/assessment.service.ts", note: "Different prototype model; not imported." }]);
  issue("functional_difference", "sections.dietary_assessment.functional_capacity", "Functional capacity is 0/1/2 in the master sheet and 1/2/3 in Assessment. Resolve before scoring.", [master("A183:B186"), source("Assessment!D21")]);
  issue("biomedical_thresholds", "sections.biomedical", "Confirm units and all lab thresholds, including equality boundaries. Haemoglobin bands overlap; SGPT/SGOT/albumin thresholds are incomplete; bilirubin and total proteins have no scoring. Assessment explicitly says Need to confirm.", [master("A112:B118"), source("Assessment!B25:D25")]);
  issue("upload_deferred", "sections.biomedical", "Report upload and automatic extraction are deferred. This template offers manual lab entry only; confirm that workflow before approval.", [source("Assessment!C25")]);
  issue("weight_baseline", "calculations", "One- and six-month changes are shown separately. Confirm the baseline, sign convention, weight-gain handling, rounding, and selection rule for the final weight-loss category; no final category is calculated.", [master("A151:B156"), source("Assessment!C20:D20")]);
  issue("symptom_overlap", "sections.dietary_assessment.dietary_symptoms", "GI and dietary symptoms overlap and use different points. Confirm double-counting prevention, aggregation, and the GI cap of 6 missing from the Assessment tab.", [master("A84:B93"), master("A165:B181"), source("Assessment!D15")]);
  issue("treatment_ambiguity", "sections.medical_history.treatment_status", "Clarify palliative versus post-treatment maintenance conditions, time windows, and required inputs. Confirm whether current therapies are multi-select and how combined therapies score.", [master("A49:B53"), master("A120:B126"), source("Assessment!D7:D8")]);
  issue("required_answers", "sections", "Required fields and unknown/not-applicable policies are unspecified. Fields are optional for draft preview only. Confirm requirements and explicit none selection for multi-select lists; empty answers must not mean normal or no symptoms.", [source("Assessment!B2:D25")]);
  issue("stool_boundaries", "sections.gut_symptoms.stool_frequency", "Daily overlaps with >3/week, and exactly 3/week is missing. Confirm mutually meaningful options and boundaries.", [master("A99:B102")]);
  issue("question_structure", "sections.diagnosis", "Tumour type, behaviour, and origin have been separated as draft fields; confirm this grouping, cardinality, age input, and missing gender options before approval.", [master("A6:A15"), source("Assessment!C2:D4")]);
  issue("score_ranges", "classifications", "Source categories assume whole-number scores: 0–15, 16–25, >25. Confirm rounding and handling of fractional values between 15 and 16.", [master("D19:F21")]);
  issue("interventions_missing", "interventions", "Goals and dietary-regime fields are present, but automatic triggers, recommendations, priorities, and conflict rules are unspecified. No clinical guidance is generated until defined.", [master("A210:A217")]);
  issue("sga_relationship", "sections.clinician_assessment.sga_score", "Clarify the SGA total calculation and its relationship to the NIQ score; the ≥6 risk note must not be substituted for NIQ risk categories.", [master("A208:A209")]);
  issue("careplix_mapping", "scoring", "No supplied rule defines how CarePlix measurements or wellness scores affect NIQ scoring. They are not combined automatically.", [{ document: "CarePlix-Integration-Reference.pdf", location: "Integration result fields", note: "Integration reference does not define NIQ scoring." }]);
  issue("previous_history_scoring", "sections.medical_history", "Previous surgery / long-term illness has none 0, present 1 scoring, but the source provides free text without an explicit none answer. Confirm presence capture; unanswered text is not treated as no history.", [master("A71:B75"), source("Assessment!B11:D11")]);
  issue("medication_aggregation", "sections.treatment_medications", "Each selected medication or supplement carries one source point. Confirm whether categories count once or whether multiple medicines within one category must be captured, and any combined cap.", [master("A130:B147"), source("Assessment!D19")]);
  for (const [id, resolution] of [
    ["model_difference", "The user confirmed Excel is the latest authoritative source. Use the workbook domain caps and 35-point total as configurable defaults; do not import the prototype's 100-point model."],
    ["functional_difference", "Assessment!G3 explicitly directs use of the NIQ master question sheet for dropdowns and scoring. Default to master A184:B186: normal 0, reduced 1, bedridden 2."],
  ]) {
    const resolved = definition.issues.find(issue => issue.id === id)!;
    resolved.resolved = true;
    resolved.resolution = resolution!;
    if (id === "functional_difference") resolved.sources.push(source("Assessment!G3"));
  }
  return ruleDefinitionSchema.parse(definition);
}
