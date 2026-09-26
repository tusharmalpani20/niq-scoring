import { describe, expect, test } from "bun:test";
import { createFinalAssessmentTemplate, createLegacyFinalAssessmentTemplate, upgradeFinalAssessmentDefinition, withDefaultRiskCategoryColors } from "./final-assessment-template";
import { finalAssessmentDefinitionSchema } from "./final-assessment";
import { isFixedFinalAssessmentDefinition, validateFinalAssessmentDefinition } from "./final-assessment-validation";
import { publicQuestionnaire } from "./rule-public";

describe("final assessment profile contract", () => {
  test("matches the audited five-section, nineteen-entry inventory", () => {
    const definition = createFinalAssessmentTemplate("Assessment v2");
    expect(definition.sections.map(section => section.fields.length)).toEqual([3, 5, 3, 2, 6]);
    expect(definition.sections.flatMap(section => section.fields)).toHaveLength(19);
    expect(definition.sections.map(section => section.accent)).toEqual(["orange", "green", "grey", "purple", "beige"]);
    expect(definition.riskCategories.at(-1)?.max).toBeNull();
    expect(isFixedFinalAssessmentDefinition(definition)).toBe(true);
    expect(validateFinalAssessmentDefinition(definition)).toEqual([]);
  });

  test("keeps source-owned fields and options fixed while allowing points and risk categories to change", () => {
    const definition = createFinalAssessmentTemplate("Assessment v2");
    const stage = definition.sections[0]!.fields[1]!;
    if (stage.kind !== "select") throw new Error("stage fixture");
    stage.scoring.points[0]!.points = 9;
    definition.riskCategories[0]!.label = "Low draft";
    expect(isFixedFinalAssessmentDefinition(definition)).toBe(true);
    stage.options[0]!.label = "Tampered option";
    expect(isFixedFinalAssessmentDefinition(definition)).toBe(false);
    expect(validateFinalAssessmentDefinition(definition).some(issue => issue.code === "FIXED_PROFILE_REQUIRED")).toBe(true);
  });

  test("accepts configured category colors and reads definitions saved before colors existed", () => {
    const definition = createFinalAssessmentTemplate("Assessment v2");
    definition.riskCategories[0]!.color = "purple";
    expect(finalAssessmentDefinitionSchema.safeParse(definition).success).toBe(true);
    definition.riskCategories[0]!.color = "#12aBcD";
    expect(finalAssessmentDefinitionSchema.safeParse(definition).success).toBe(true);
    for (const invalid of ["#12345", "#1234567", "#xyzxyz", "red; color: blue"]) {
      expect(finalAssessmentDefinitionSchema.safeParse({ ...definition, riskCategories: [{ ...definition.riskCategories[0], color: invalid }, ...definition.riskCategories.slice(1)] }).success).toBe(false);
    }
    definition.riskCategories[0]!.color = undefined;
    expect(finalAssessmentDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(validateFinalAssessmentDefinition(definition, { requireRiskCategoryColors: true })).toContainEqual(expect.objectContaining({ path: "riskCategories.0.color", code: "RISK_COLOR_REQUIRED" }));
    expect(finalAssessmentDefinitionSchema.safeParse({ ...definition, riskCategories: [{ ...definition.riskCategories[0], color: "not-a-color" }, ...definition.riskCategories.slice(1)] }).success).toBe(false);
  });

  test("fills missing draft colors without rewriting a historical definition", () => {
    const historical = createFinalAssessmentTemplate("Old draft");
    historical.riskCategories.forEach(category => { delete category.color; });
    historical.riskCategories.push({ id: "custom", label: "Custom", min: 100, max: 101, minInclusive: true, maxInclusive: true, interpretation: "", sources: [] });
    const filled = withDefaultRiskCategoryColors(historical);
    expect(filled.riskCategories.map(category => category.color)).toEqual(["green", "amber", "red", "neutral"]);
    expect(historical.riskCategories.every(category => category.color === undefined)).toBe(true);
  });

  test("rejects cap and arbitrary fields through the strict v2 schema", () => {
    const definition = createFinalAssessmentTemplate("Assessment v2");
    expect(finalAssessmentDefinitionSchema.safeParse({ ...definition, cap: 35 }).success).toBe(false);
    expect(finalAssessmentDefinitionSchema.safeParse({ ...definition, sections: definition.sections.map((section, index) => index === 0 ? { ...section, fields: [...section.fields, { id: "identity", label: "Name", kind: "select", options: [], scoring: { kind: "options", aggregation: "sum", points: [] }, help: "", unit: "", sources: [] }] } : section) }).success).toBe(false);
  });

  test("public projection contains scoring dependencies but no points or patient identity", () => {
    const publicView = publicQuestionnaire(createFinalAssessmentTemplate("Assessment v2"));
    expect(publicView.formatVersion).toBe(2);
    expect(JSON.stringify(publicView)).not.toContain("points");
    expect(publicView.sections.flatMap(section => section.fields).map(field => field.id)).not.toContain("patient_name");
    expect(publicView.supportingInputs.map(input => input.id)).not.toEqual(expect.arrayContaining(["age", "gender", "contact"]));
    expect(publicView.sections.flatMap(section => section.fields)).toHaveLength(19);
  });
});


test("explicit draft upgrade preserves the source and customized option points", () => {
  const legacy = createLegacyFinalAssessmentTemplate("Existing draft");
  const stage = legacy.sections[0]!.fields[1]!;
  if (stage.kind !== "select") throw new Error("stage");
  stage.scoring.points[0]!.points = 8;
  const original = structuredClone(legacy);
  const upgraded = upgradeFinalAssessmentDefinition(legacy);
  expect(legacy).toEqual(original);
  expect(isFixedFinalAssessmentDefinition(legacy)).toBe(true);
  expect(isFixedFinalAssessmentDefinition(upgraded)).toBe(true);
  expect(upgraded.sections[0]!.fields[1]!.scoring).toEqual(stage.scoring);
  expect(upgraded.provisional.status).toBe("CLIENT_CONFIRMED");
});

test("confirmed points require integers while earlier definitions remain readable", () => {
  const legacy = createLegacyFinalAssessmentTemplate("Legacy");
  const stage = legacy.sections[0]!.fields[1]!;
  if (stage.kind !== "select") throw new Error("stage");
  stage.scoring.points[0]!.points = 1.5;
  expect(validateFinalAssessmentDefinition(legacy)).toEqual([]);
  expect(validateFinalAssessmentDefinition(upgradeFinalAssessmentDefinition(legacy))).toContainEqual(expect.objectContaining({ code: "INTEGER_POINTS_REQUIRED" }));
});
