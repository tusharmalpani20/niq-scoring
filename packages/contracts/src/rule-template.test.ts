import { describe, expect, test } from "bun:test";
import { createSpreadsheetTemplate } from "./rule-template";
import { ruleDefinitionSchema } from "./rule-definition";
import { validateRuleDefinition } from "./rule-validation";

describe("spreadsheet template", () => {
  test("covers all source sections and preserves uncommon source options", () => {
    const definition = createSpreadsheetTemplate("NIQ worksheet draft");
    expect(ruleDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(validateRuleDefinition(definition).filter(issue => issue.severity === "error")).toEqual([]);
    expect(definition.sections.map(s => s.id)).toEqual(["patient_details", "diagnosis", "medical_history", "gut_symptoms", "biomedical", "treatment_medications", "dietary_assessment", "clinician_assessment"]);
    const questions = definition.sections.flatMap(s => s.questions);
    expect(questions.length).toBeGreaterThan(65);
    const find = (id: string) => questions.find(q => q.id === id)!;
    expect(find("cancer_type").options).toHaveLength(23);
    expect(find("cancer_type").options.map(o => o.id)).toContain("cancer_type_unknown");
    expect(find("gi_symptoms").options).toHaveLength(9);
    expect(find("dietary_symptoms").options).toHaveLength(16);
    expect(find("nutrition_goals").options).toHaveLength(8);
    expect(find("bilirubin").sources[0]?.location).toBe("Assessment!B25:D25");
    expect(find("total_proteins")).toBeDefined();
    expect(find("dietary_regime").purpose).toBe("clinician");
    expect(find("microbiota_test").options).toHaveLength(4);
    expect(find("supplement_details").visibleWhen?.tests[0]?.value).toBe("supplements_other");
  });

  test("identifiers are globally unique and conditional options resolve", () => {
    const d = createSpreadsheetTemplate("IDs");
    const questions = d.sections.flatMap(s => s.questions);
    const ids = [...d.sections.map(s => s.id), ...questions.map(q => q.id), ...questions.flatMap(q => q.options.map(o => o.id)), ...d.calculations.map(c => c.id), ...d.domains.map(v => v.id), ...d.classifications.map(c => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of questions) {
      expect(q.sources.length).toBeGreaterThan(0);
      for (const condition of q.visibleWhen?.tests ?? []) {
        const parent = questions.find(candidate => candidate.id === condition.ref.id);
        expect(parent).toBeDefined();
        if (typeof condition.value === "string") expect(parent!.options.map(o => o.id)).toContain(condition.value);
      }
    }
  });

  test("does not invent clinical mappings or silently resolve source conflicts", () => {
    const d = createSpreadsheetTemplate("Unapproved template");
    expect(d.scoring).toEqual([]);
    expect(d.interventions).toEqual([]);
    expect(d.domains.map(v => v.cap)).toEqual([5, 10, 5, 5, 10]);
    expect(d.total.cap).toBe(35);
    expect(d.issues.every(i => i.blocking && !i.resolved && i.sources.length > 0)).toBe(true);
    for (const id of ["domain_mapping", "model_difference", "functional_difference", "biomedical_thresholds", "upload_deferred", "weight_baseline", "symptom_overlap", "required_answers", "interventions_missing", "careplix_mapping"]) expect(d.issues.some(i => i.id === id)).toBe(true);
    expect(d.issues.find(i => i.id === "functional_difference")?.sources.map(s => s.location)).toEqual(["NIQ master question sheet!A183:B186", "Assessment!D21"]);
  });

  test("calculations preserve both possible baselines without selecting a scoring baseline", () => {
    const d = createSpreadsheetTemplate("Calculations");
    expect(d.calculations[0]?.operands).toEqual([{ kind: "question", id: "weight_kg" }, { kind: "question", id: "height_cm" }]);
    expect(d.calculations[1]?.operands).toEqual([{ kind: "question", id: "weight_one_month" }, { kind: "question", id: "weight_kg" }]);
    expect(d.calculations[2]?.operands).toEqual([{ kind: "question", id: "weight_six_months" }, { kind: "question", id: "weight_kg" }]);
    expect(d.issues.find(i => i.id === "weight_baseline")?.blocking).toBe(true);
  });

  test("each creation returns isolated mutable draft data", () => {
    const a = createSpreadsheetTemplate("First");
    const b = createSpreadsheetTemplate("Second");
    a.sections[0]!.questions[0]!.label = "Changed";
    a.issues[0]!.resolved = true;
    a.domains[0]!.cap = 999;
    expect(b.name).toBe("Second");
    expect(b.sections[0]!.questions[0]!.label).toBe("Name");
    expect(b.issues[0]!.resolved).toBe(false);
    expect(b.domains[0]!.cap).toBe(5);
  });
});
