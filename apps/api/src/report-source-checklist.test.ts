import { expect, test } from "bun:test";
import { assessReportChecklist, buildReportChecklist } from "./report-source-checklist";
import { ReportModelError } from "./openrouter-report-client";

const evidence = [
  { id: "fact:niq_risk", text: "Moderate risk." },
  { id: "rule:treatment:radiotherapy", text: "Eat 2–3 snacks. Use safe drinking water. Ask your care team to correct documented deficiencies." },
  { id: "rule:product:plan", text: "Mix 1 sachet in 150 mL water." },
  { id: "possible:toxicity:mucositis", text: "If sores occur, choose soft food." },
];
const action = (sourceQuote: string, destination = "nutritionAdvice", cardEvidenceId: string | null = null, stage = "narrative") =>
  ({ action: sourceQuote, qualification: "", sourceQuote, destination, cardEvidenceId, stage });
const valid = () => ({ sources: [
  { evidenceId: evidence[0]!.id, actions: [] },
  { evidenceId: evidence[1]!.id, actions: [action("Eat 2–3 snacks."), action("Use safe drinking water.", "foodSafetyAdvice"),
    action("Ask your care team to correct documented deficiencies.")] },
  { evidenceId: evidence[2]!.id, actions: [action(evidence[2]!.text, "structuredProductPlan", null, "assembled")] },
  { evidenceId: evidence[3]!.id, actions: [action(evidence[3]!.text, "possibleEffectCard", evidence[3]!.id, "card")] },
] });

type Unit = { unitId: number; evidenceId: string; sourceQuote: string };
function assignments(user: string) {
  const { units } = JSON.parse(user) as { units: Unit[] };
  return { assignments: units.map(unit => ({ unitId: unit.unitId,
    destination: unit.evidenceId.startsWith("possible:") ? "possibleEffectCard"
      : /^(?:rule:product:|catalog:product:)/u.test(unit.evidenceId) ? "structuredProductPlan"
        : unit.sourceQuote.includes("safe drinking water") ? "foodSafetyAdvice" : "nutritionAdvice",
    cardEvidenceId: unit.evidenceId.startsWith("possible:") ? unit.evidenceId : null,
  })) };
}

test("one compact placement call retains exact source prose and semantic destinations", async () => {
  let calls = 0;
  const result = await buildReportChecklist({ evidence, invoke: async (step, system, user, schema) => {
    calls++;
    expect(step).toBe("manager");
    expect(system).toContain("do not rewrite or quote any source text");
    const request = JSON.parse(user) as { evidence: typeof evidence; units: Unit[] };
    expect(request.evidence).toEqual(evidence);
    expect(request.units).toHaveLength(5);
    expect(request.units.some(unit => unit.evidenceId.startsWith("fact:"))).toBe(false);
    expect(JSON.stringify(schema)).not.toContain('"action"');
    return assignments(user);
  } });
  expect(calls).toBe(1);
  expect(result.checklist.sources[0]!.actions).toEqual([]);
  expect(result.checklist.sources[1]!.actions.map(row => row.destination)).toEqual(["nutritionAdvice", "foodSafetyAdvice", "nutritionAdvice"]);
  expect(result.checklist.sources[1]!.actions.map(row => row.action)).toEqual(valid().sources[1]!.actions.map(row => row.sourceQuote));
  expect(result.context).toContain("Eat 2–3 snacks.");
});

test("missing, duplicate and unknown unit IDs and invented destinations hold generation", async () => {
  for (const mutate of [
    (rows: ReturnType<typeof assignments>["assignments"]) => rows.slice(1),
    (rows: ReturnType<typeof assignments>["assignments"]) => [...rows.slice(1), rows[1]!],
    (rows: ReturnType<typeof assignments>["assignments"]) => rows.map((row, i) => i === 0 ? { ...row, unitId: 9999 } : row),
    (rows: ReturnType<typeof assignments>["assignments"]) => rows.map((row, i) => i === 0 ? { ...row, destination: "invented" } : row),
  ]) await expect(buildReportChecklist({ evidence, invoke: async (_step, _system, user) => ({
    assignments: mutate(assignments(user).assignments),
  }) })).rejects.toThrow("MODEL_INVALID_SOURCE_CHECKLIST");
});

test("product and conditional units cannot be moved into universal narrative instructions", async () => {
  for (const prefix of ["rule:product:", "possible:"]) await expect(buildReportChecklist({ evidence,
    invoke: async (_step, _system, user) => {
      const request = JSON.parse(user) as { units: Unit[] };
      const id = request.units.find(unit => unit.evidenceId.startsWith(prefix))!.unitId;
      return { assignments: assignments(user).assignments.map(row => row.unitId === id
        ? { ...row, destination: "nutritionAdvice", cardEvidenceId: null } : row) };
    },
  })).rejects.toThrow("MODEL_INVALID_SOURCE_CHECKLIST");
});

test("source validation rejects unknown IDs, missing care sources and fabricated quotations", () => {
  for (const response of [
    { sources: valid().sources.slice(1) },
    { sources: [...valid().sources, valid().sources[0]] },
    { sources: valid().sources.map((row, i) => i === 1 ? { ...row, evidenceId: "rule:unknown" } : row) },
    { sources: valid().sources.map((row, i) => i === 1 ? { ...row, actions: [] } : row) },
    { sources: valid().sources.map((row, i) => i === 1 ? { ...row, actions: [action("Eat 7 snacks.")] } : row) },
  ]) expect(assessReportChecklist(response, evidence)).toBeNull();
});

test("long mixed rows and decimal targets retain every source character without model copying", async () => {
  const instructions = ["Aim for 1.2–1.5 g/kg/day.", ...Array.from({ length: 20 }, (_, i) => `Action ${i + 1}: follow source instruction.`)];
  const source = { id: "rule:treatment:long", text: instructions.slice(0, 10).join(" ") + "\n" + instructions.slice(10).join(" ") };
  const result = await buildReportChecklist({ evidence: [source], invoke: async (_step, _system, user) => assignments(user) });
  const quotes = result.checklist.sources[0]!.actions.map(row => row.sourceQuote);
  expect(quotes).toEqual(instructions);
  expect(quotes.join(" ").replace(/\s/gu, "")).toBe(source.text.replace(/\s/gu, ""));
});

test("target resolutions override original numeric units globally without deleting source evidence", async () => {
  const sources = [
    { id: "rule:nutrition:general", text: "Protein 1.5–2 g/kg/day. Preserve muscle function." },
    { id: "resolution:target:protein", text: "Use 1.2–1.5 g/kg/day from the selected treatment source." },
  ];
  const result = await buildReportChecklist({ evidence: sources, invoke: async (_step, system, user) => {
    expect(system).toContain("do not treat a superseded numeric value as a required patient target");
    return assignments(user);
  } });
  expect(result.checklist.sources[0]!.actions[0]!.id).toBe("rule:nutrition:general:action:1");
  expect(result.context).toContain("recorded target resolutions override superseded numeric source units");
});

test("planner provider failures receive a held-only identity while trace errors remain visible", async () => {
  await expect(buildReportChecklist({ evidence, invoke: async () => { throw new ReportModelError("MODEL_TIMEOUT"); } }))
    .rejects.toThrow("MODEL_SOURCE_CHECKLIST_FAILED");
  const traceError = new Error("Trace persistence failed");
  await expect(buildReportChecklist({ evidence, invoke: async () => { throw traceError; } })).rejects.toBe(traceError);
});
