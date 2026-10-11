import workbookDefaults from "./report-guidance-defaults.json";
import { reportGuidanceSchema, type FinalAssessmentDefinition } from "./final-assessment";
import { initialDrugClassConfig } from "./drug-class-template";

type ReportGuidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;

// Source text is transcribed from the two supplied CSVs, with corrupted CSV
// arrows/comparison symbols checked against the corresponding supplied ODS tabs.
const defaults: ReportGuidance = reportGuidanceSchema.parse(workbookDefaults);

/** Return independent editable rows for each new rule version or explicit import. */
export function initialReportGuidance(): ReportGuidance {
  return structuredClone(defaults);
}

/** Check references before replacing an older draft with the workbook defaults. */
export function workbookGuidanceImportIssues(definition: FinalAssessmentDefinition): string[] {
  const risks = new Set(definition.riskCategories.map(item => item.id));
  const classes = new Set(definition.drugClassConfig?.classes.map(item => item.id) ?? []);
  const treatments = new Set(definition.sections.flatMap(section => section.fields)
    .filter(field => field.id === "current_cancer_treatment" && "options" in field)
    .flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
  const missingRisks = defaults.nutrition.filter(item => item.riskCategoryId && !risks.has(item.riskCategoryId)).map(item => item.label);
  const missingClasses = [...new Set(defaults.toxicity.filter(item => !classes.has(item.classId)).map(item => item.classId))]
    .map(id => ({ id, label: initialDrugClassConfig().classes.find(item => item.id === id)?.label ?? id }));
  const missingTreatments = [...new Set(defaults.toxicity.filter(item => !treatments.has(item.treatmentTypeId)).map(item => item.treatmentTypeId))];
  return [
    ...(missingRisks.length ? [`Missing risk categories: ${missingRisks.join(", ")}.`] : []),
    ...(missingClasses.length ? [`Missing drug classes: ${missingClasses.map(item => item.label).join(", ")}.`] : []),
    ...(missingTreatments.length ? [`Missing treatments: ${missingTreatments.join(", ")}.`] : []),
  ];
}
