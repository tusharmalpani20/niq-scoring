import { expect, test } from "bun:test";
import { publicQuestionnaire } from "./rule-public";
import { createSpreadsheetTemplate } from "./rule-template";

test("public projection keeps renderer fields and excludes internal definition fields", () => {
  const definition = createSpreadsheetTemplate("Private version name");
  const output = publicQuestionnaire(definition);
  expect(Object.keys(output)).toEqual(["formatVersion", "sections"]);
  expect(Object.keys(output.sections[0]!)).toEqual(["id", "title", "description", "questions"]);
  expect(Object.keys(output.sections[0]!.questions[0]!)).toEqual(["id", "label", "type", "help", "unit", "required", "options", "validation", "visibleWhen"]);
  const serialized = JSON.stringify(output);
  for (const field of ["sources", "scoring", "interventions", "samples", "issues", "domains", "classifications", "calculations", "purpose"]) expect(serialized).not.toContain(`"${field}":`);
  expect(serialized).not.toContain("Source scoring instruction");
  expect(serialized).not.toContain("Yes: 1; no: 0");
  expect(serialized).not.toContain("≥6");
  expect(serialized).not.toContain("Private version name");
  const questions = output.sections.flatMap(s => s.questions);
  expect(questions.find(q => q.id === "height_cm")?.validation).toEqual({ min: 0 });
  expect(questions.find(q => q.id === "surgery_date")?.visibleWhen?.tests[0]).toEqual({ ref: { kind: "question", id: "surgery_status" }, operator: "eq", value: "surgery_status_done" });
});

test("projection excludes unknown nested fields and returns independent objects", () => {
  const definition = createSpreadsheetTemplate("Projection");
  const q = definition.sections[1]!.questions[0]!;
  Object.assign(q, { privateField: "secret" });
  Object.assign(q.options[0]!, { points: 99 });
  Object.assign(q.validation, { privateField: "secret" });
  const output = publicQuestionnaire(definition);
  expect(JSON.stringify(output)).not.toContain("secret");
  expect(JSON.stringify(output)).not.toContain('"points":');
  output.sections[1]!.questions[0]!.options[0]!.label = "Changed";
  expect(q.options[0]!.label).toBe("Solid tumour");
});

test("template scoring notes remain internally available after projection", () => {
  const definition = createSpreadsheetTemplate("Source notes");
  const questions = definition.sections.flatMap(s => s.questions);
  expect(questions.find(q => q.id === "tumour_type")?.sources[0]?.note).toBe("Solid: 2; haematological: 1.");
  expect(questions.find(q => q.id === "family_cancer")?.sources[0]?.note).toBe("Yes: 1; no: 0.");
  expect(questions.find(q => q.id === "sga_score")?.sources[0]?.note).toContain("≥6");
  expect(questions.every(q => q.help === "")).toBe(true);
});
