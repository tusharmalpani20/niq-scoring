import { describe, expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "./final-assessment-template";
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
