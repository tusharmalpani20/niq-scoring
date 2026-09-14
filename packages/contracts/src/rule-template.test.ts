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
    const ids = [...d.sections.map(s => s.id), ...questions.map(q => q.id), ...questions.flatMap(q => q.options.map(o => o.id)), ...d.calculations.map(c => c.id), ...d.domains.map(v => v.id), ...d.scoring.map(rule => rule.id), ...d.classifications.map(c => c.id)];
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
    expect(d.scoring.length).toBeGreaterThan(20);
    expect(d.scoring.every(rule => rule.domainId === "unassigned")).toBe(true);
    expect(d.interventions).toEqual([]);
    expect(d.domains.filter(v => v.id !== "unassigned").map(v => v.cap)).toEqual([5, 10, 5, 5, 10]);
    expect(d.total.cap).toBe(35);
    expect(d.issues.every(i => i.blocking && i.sources.length > 0)).toBe(true);
    for (const id of ["domain_mapping", "model_difference", "functional_difference", "biomedical_thresholds", "upload_deferred", "weight_baseline", "symptom_overlap", "required_answers", "interventions_missing", "careplix_mapping"]) expect(d.issues.some(i => i.id === id)).toBe(true);
    expect(d.issues.find(i => i.id === "functional_difference")?.sources.map(s => s.location)).toEqual(["NIQ master question sheet!A183:B186", "Assessment!D21", "Assessment!G3"]);
    expect(d.issues.filter(i => i.resolved).map(i => i.id)).toEqual(["model_difference", "functional_difference"]);
    expect(d.scoring.filter(rule => rule.kind === "ranges").map(rule => rule.id)).toEqual(["creatinine_score", "crp_score"]);
    expect(validateRuleDefinition(d).some(issue => issue.code === "UNMAPPED_OPTION")).toBe(true);
  });

  test("preserves explicit lab thresholds while blocking unspecified equality instead of guessing", () => {
    const d = createSpreadsheetTemplate("Lab source defaults");
    for (const [questionId, threshold, cell] of [["creatinine", 1.4, "A117:B117"], ["crp", 10, "A118:B118"]] as const) {
      const index = d.scoring.findIndex(rule => rule.id === `${questionId}_score`);
      const rule = d.scoring[index]!;
      expect(rule.kind).toBe("ranges");
      if (rule.kind !== "ranges") throw new Error("Expected numeric lab scoring");
      expect(rule.bands).toEqual([
        { id: `${questionId}_below`, min: null, max: threshold, minInclusive: false, maxInclusive: false, points: 1 },
        { id: `${questionId}_above`, min: threshold, max: null, minInclusive: false, maxInclusive: false, points: 2 },
      ]);
      expect(rule.sources[0]?.location).toBe(`NIQ master question sheet!${cell}`);
      expect(validateRuleDefinition(d).some(issue => issue.code === "RANGE_GAP" && issue.path === `scoring.${index}.bands`)).toBe(true);
    }
    for (const id of ["haemoglobin_score", "sgpt_score", "sgot_score", "albumin_score", "bilirubin_score", "total_proteins_score", "dietary_intake_score", "bmi_score"]) {
      expect(d.scoring.some(rule => rule.id === id)).toBe(false);
    }
    expect(d.issues.find(issue => issue.id === "biomedical_thresholds")?.resolved).toBe(false);
  });

  test("uses explicit workbook points and the six-point GI cap without prototype defaults", () => {
    const d = createSpreadsheetTemplate("Source defaults");
    const rule = (id: string) => d.scoring.find(rule => rule.id === `${id}_score`)!;
    const points = (id: string) => { const score = rule(id); return score.kind === "options" ? score.points.map(point => point.points) : []; };
    expect(points("tumour_type")).toEqual([2, 1]);
    expect(points("surgery_status")).toEqual([1, 2, 0, 3]);
    expect(points("appetite")).toEqual([0, 2, 3]);
    expect(points("functional_capacity")).toEqual([0, 1, 2]);
    expect(points("dietary_symptoms")).toEqual([0, 3, 1, 3, 1, 3, 2, 1, 1, 1, 2, 1, 3, 1, 3, 1]);
    expect(rule("gi_symptoms")).toMatchObject({ aggregation: "sum", cap: 6, sources: [{ location: "NIQ master question sheet!A85:B93" }] });
    expect(rule("comorbidities")).toMatchObject({ aggregation: "max" });
    expect(rule("has_intolerance")).toMatchObject({ kind: "condition", points: 1, otherwise: 0 });
    expect(points("treatment_status")).toEqual([0, 2, 1]);
    for (const score of d.scoring) expect(score.sources.length).toBeGreaterThan(0);
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
