import workbookDefaults from "./report-guidance-defaults.json" with { type: "json" };
import { reportGuidanceSchema, type FinalAssessmentDefinition } from "./final-assessment";
import { classOnlyToxicity } from "./report-guidance";

type ReportGuidance = NonNullable<FinalAssessmentDefinition["reportGuidance"]>;

// Source text is transcribed from the two supplied CSVs, with corrupted CSV
// arrows/comparison symbols checked against the corresponding supplied ODS tabs.
const defaults: ReportGuidance = reportGuidanceSchema.parse(workbookDefaults);

/** Return independent source rows; the rule template attaches audited match defaults. */
export function initialReportGuidance(): ReportGuidance {
  const guidance = structuredClone(defaults);
  return { ...guidance, toxicity: guidance.toxicity.map(classOnlyToxicity) };
}
