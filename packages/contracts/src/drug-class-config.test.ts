import { expect, test } from "bun:test";
import { cancerTypeIds } from "./cancer-type-ids";
import { createFinalAssessmentTemplate } from "./final-assessment-template";
import { finalAssessmentDefinitionSchema } from "./final-assessment";
import { validateFinalAssessmentDefinition } from "./final-assessment-validation";
import { publicQuestionnaire } from "./rule-public";

test("new drafts seed 16 workbook classes plus the generic Other option", () => {
  const definition = createFinalAssessmentTemplate("Drug class draft");
  expect(definition.drugClassConfig?.classes).toHaveLength(17);
  expect(definition.drugClassConfig?.classes.at(-1)).toEqual({ id: "other", label: "Other" });
  expect(definition.drugClassConfig?.suggestions).toHaveLength(92);
  expect(definition.drugClassConfig?.suggestions.every(item => item.cancerTypeId !== null)).toBe(true);
  expect(definition.drugClassConfig?.classes.every(item => item.guidance === undefined)).toBe(true);
  expect(validateFinalAssessmentDefinition(definition)).toEqual([]);
  expect(JSON.stringify(definition.drugClassConfig)).not.toContain("points");
});

test("baseline class associations match the workbook treatment categories and cancer examples", () => {
  // Oncology Drug Class & Nutrition Guide (NIQ).ods, Drug_classes rows 2–17
  // and Drugs_by_treatment rows 2–84.
  const workbookGroups = {
    current_cancer_treatment_chemotherapy: [
      "Taxanes", "Anthracyclines", "Alkylating agents", "Platinum agents",
      "Antimetabolites", "Topoisomerase inhibitors", "Vinca alkaloids",
    ],
    current_cancer_treatment_targeted: [
      "Tyrosine kinase inhibitors", "PARP inhibitors", "HER2-targeted antibodies",
      "CD20 monoclonal antibodies", "CDK4/6 inhibitors",
    ],
    current_cancer_treatment_immunotherapy: ["Immune checkpoint inhibitors"],
    current_cancer_treatment_hormonal: [
      "Anti-estrogens / SERMs", "Aromatase inhibitors",
      "Anti-androgens / androgen deprivation therapy",
    ],
  };
  const definition = createFinalAssessmentTemplate("Workbook baseline");
  const config = definition.drugClassConfig!;
  const labels = new Map(config.classes.map(item => [item.id, item.label]));
  const actual = Object.fromEntries(Object.keys(workbookGroups).map(treatmentTypeId => [
    treatmentTypeId,
    [...new Set(config.suggestions
      .filter(item => item.treatmentTypeId === treatmentTypeId)
      .map(item => labels.get(item.classId)))],
  ]));
  expect(actual).toEqual(workbookGroups);
  const cancerIds = new Set<string>(cancerTypeIds);
  expect(config.suggestions.every(item => item.cancerTypeId === null || cancerIds.has(item.cancerTypeId))).toBe(true);
  const classesFor = (cancerTypeId: string, treatmentTypeId: string) => config.suggestions
    .filter(item => item.cancerTypeId === cancerTypeId && item.treatmentTypeId === treatmentTypeId)
    .map(item => labels.get(item.classId));
  expect(classesFor("cancer_cml", "current_cancer_treatment_targeted")).toContain("Tyrosine kinase inhibitors");
  expect(classesFor("cancer_triple_negative_breast", "current_cancer_treatment_chemotherapy")).toEqual(["Platinum agents"]);
  expect(classesFor("cancer_her2_positive_breast", "current_cancer_treatment_targeted")).toEqual(["Tyrosine kinase inhibitors", "HER2-targeted antibodies"]);
  expect(classesFor("cancer_er_positive_breast", "current_cancer_treatment_hormonal")).toEqual(["Anti-estrogens / SERMs", "Aromatase inhibitors"]);
  expect(classesFor("cancer_small_cell_lung", "current_cancer_treatment_chemotherapy")).toEqual(["Topoisomerase inhibitors"]);
  expect(classesFor("cancer_other", "current_cancer_treatment_chemotherapy")).toEqual([]);
  expect(config.suggestions.some(item => item.treatmentTypeId === "current_cancer_treatment_radiation" || item.treatmentTypeId === "current_cancer_treatment_other")).toBe(false);

  const treatmentField = definition.sections.flatMap(section => section.fields)
    .find(field => field.id === "current_cancer_treatment");
  if (!treatmentField || !("options" in treatmentField)) throw new Error("Current cancer treatment choices missing");
  expect(treatmentField.options.map(option => option.id)).toEqual([
    "current_cancer_treatment_chemotherapy", "current_cancer_treatment_immunotherapy",
    "current_cancer_treatment_radiation", "current_cancer_treatment_targeted",
    "current_cancer_treatment_hormonal", "current_cancer_treatment_other",
  ]);
});

test("public questionnaire includes only class labels and suggestions", () => {
  const definition = createFinalAssessmentTemplate("Drug class draft");
  definition.drugClassConfig!.classes[0]!.guidance = "Private class-wide guidance";
  const publicView = publicQuestionnaire(definition);
  expect(publicView.formatVersion).toBe(2);
  if (publicView.formatVersion !== 2) throw new Error("Expected final assessment");
  expect(publicView.drugClassConfig?.classes[0]).toEqual({ id: "taxanes", label: "Taxanes" });
  expect(JSON.stringify(publicView)).not.toContain("Private class-wide guidance");
  expect(publicView.drugClassConfig?.suggestions[0]).toEqual({
    cancerTypeId: "cancer_1", treatmentTypeId: "current_cancer_treatment_chemotherapy", classId: "taxanes",
  });
});

test("old definitions without drug classes remain readable", () => {
  const definition = createFinalAssessmentTemplate("Historical");
  delete definition.drugClassConfig;
  delete definition.reportGuidance;
  expect(finalAssessmentDefinitionSchema.safeParse(definition).success).toBe(true);
  expect(validateFinalAssessmentDefinition(definition)).toEqual([]);
  const publicView = publicQuestionnaire(definition);
  expect(publicView).not.toHaveProperty("drugClassConfig");
});

test("drug class IDs, labels, and suggestion references must be sound", () => {
  const definition = createFinalAssessmentTemplate("Invalid mappings");
  const config = definition.drugClassConfig!;
  config.classes.push({ id: "taxanes", label: " TAXANES " });
  config.suggestions.push({ cancerTypeId: "cancer_1", treatmentTypeId: "current_cancer_treatment_chemotherapy", classId: "taxanes" });
  config.suggestions.push({ cancerTypeId: "cancer_unknown_value", treatmentTypeId: "bad_treatment", classId: "bad_class" });
  const codes = validateFinalAssessmentDefinition(definition).map(issue => issue.code);
  expect(codes).toContain("DUPLICATE_DRUG_CLASS_ID");
  expect(codes).toContain("DUPLICATE_DRUG_CLASS_NAME");
  expect(codes).toContain("DUPLICATE_DRUG_CLASS_SUGGESTION");
  expect(codes).toContain("UNKNOWN_DRUG_CLASS");
  expect(codes).toContain("UNKNOWN_TREATMENT");
  expect(codes).toContain("UNKNOWN_CANCER_TYPE");
});
