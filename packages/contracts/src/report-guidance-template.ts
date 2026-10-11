import workbookDefaults from "./report-guidance-defaults.json" with { type: "json" };
import { reportGuidanceSchema, type FinalAssessmentDefinition } from "./final-assessment";

type ReportGuidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;

// Source text is transcribed from the two supplied CSVs, with corrupted CSV
// arrows/comparison symbols checked against the corresponding supplied ODS tabs.
const defaults: ReportGuidance = reportGuidanceSchema.parse(workbookDefaults);

/** Return independent editable rows for each new rule version or explicit import. */
export function initialReportGuidance(): ReportGuidance {
  return structuredClone(defaults);
}
