import { expect, test } from "bun:test";
import { resolveReportSourceConflicts, validateReportTargetResolutions } from "./report-conflict-resolution";

const evidence = [
  { id: "fact:niq_risk", text: "High risk, reviewed score 29." },
  { id: "rule:nutrition:nutrition_high", text: "Aim for 30–35 kcal/kg/day and 1.5–2.0 g protein/kg/day." },
  { id: "rule:status:status_antimetabolites_severely_malnourished", text: "Target 30–35 kcal/kg/day and 1.2–1.5 g/kg/day protein. Preserve food safety." },
];

test("no model call is spent when matched targets agree", async () => {
  const rows = evidence.map(row => ({ ...row, text: row.text.replace("1.2–1.5", "1.5–2.0") }));
  const result = await resolveReportSourceConflicts({ evidence: rows, invoke: async () => { throw new Error("Unexpected call"); } });
  expect(result.evidence).toEqual(rows);
  expect(result.resolutions).toEqual([]);
});

test("manager can choose an existing range with a recorded reason without changing original sources", async () => {
  let calls = 0;
  const result = await resolveReportSourceConflicts({ evidence, invoke: async (step, system, user) => {
    calls++;
    expect(step).toBe("manager");
    expect(system).toContain("Do not select an overlap");
    expect(user).toContain("status_antimetabolites_severely_malnourished");
    return { resolutions: [{ nutrient: "protein", decision: "select_source", selectedSourceId: evidence[2]!.id,
      rationale: "The matched treatment/status guidance is more specific to the recorded treatment and nutritional status." }] };
  } });
  expect(calls).toBe(1);
  expect(result.evidence.slice(0, evidence.length)).toEqual(evidence);
  expect(result.evidence.at(-1)?.id).toBe("resolution:target:protein");
  expect(result.evidence.at(-1)?.text).toContain("1.2–1.5 g/kg/day");
  expect(result.resolutions[0]?.sourceIds).toEqual([evidence[1]!.id, evidence[2]!.id]);
});

test("reduced context cannot be used to declare an already matched treatment rule inapplicable", async () => {
  const result = await resolveReportSourceConflicts({ evidence, invoke: async (_step, system, user) => {
    expect(system).toContain("Every supplied matched rule is applicable");
    expect(system).toContain("Do not infer that a matched rule is inapplicable because its triggering fact is absent from this reduced context.");
    expect(JSON.parse(user).matchedRuleIds).toEqual([evidence[1]!.id, evidence[2]!.id]);
    return { resolutions: [{ nutrient: "protein", decision: "withhold_numeric", selectedSourceId: null,
      rationale: "Both rules are matched and applicable, but the reduced context does not establish a supported target priority." }] };
  } });
  expect(result.resolutions[0]?.sourceIds).toEqual([evidence[1]!.id, evidence[2]!.id]);
});

test("unjustified conflict withholds only the disputed numeric target", async () => {
  const result = await resolveReportSourceConflicts({ evidence, invoke: async () => ({ resolutions: [{
    nutrient: "protein", decision: "withhold_numeric", selectedSourceId: null,
    rationale: "Both matched rules apply and the supplied evidence does not justify preferring either target.",
  }] }) });
  expect(result.evidence.at(-1)?.text).toContain("Your care team will individualise your protein target.");
  expect(result.evidence.at(-1)?.text).not.toMatch(/1\.2|1\.5|2\.0/);
  expect(result.evidence).toHaveLength(4);
});

test("foreign source IDs, missing decisions and invented targets cannot become authoritative evidence", async () => {
  for (const response of [
    { resolutions: [] },
    { resolutions: [{ nutrient: "protein", decision: "select_source", selectedSourceId: "rule:status:foreign", rationale: "More specific." }] },
    { resolutions: [{ nutrient: "protein", decision: "select_source", selectedSourceId: evidence[1]!.id, rationale: "Choose a target.", target: "1.5 g/kg/day" }] },
  ]) await expect(resolveReportSourceConflicts({ evidence, invoke: async () => response })).rejects.toThrow("MODEL_INVALID_CONFLICT_RESOLUTION");
});

test("conditional possible-effect targets are not silently promoted into routine targets", async () => {
  const result = await resolveReportSourceConflicts({ evidence: [evidence[1]!, {
    id: "possible:toxicity:dehydration", text: "If dehydration develops, energy 20–25 kcal/kg/day and protein 1.0–1.2 g/kg/day.",
  }], invoke: async () => { throw new Error("Unexpected call"); } });
  expect(result.resolutions).toEqual([]);
});

test("a manager target choice cannot override a matched renal restriction", async () => {
  const renalEvidence = [...evidence, { id: "rule:comorbidity:chronic_kidney_disease", text: "Kidney disease: individualise nutrition targets with the care team." }];
  await expect(resolveReportSourceConflicts({ evidence: renalEvidence, invoke: async () => ({ resolutions: [{
    nutrient: "protein", decision: "select_source", selectedSourceId: evidence[1]!.id,
    rationale: "The general risk target should be used.",
  }] }) })).rejects.toThrow("MODEL_INVALID_CONFLICT_RESOLUTION");
});

test("all conflicting nutrients need distinct decisions in the same bounded call", async () => {
  const rows = evidence.map(row => row.id.startsWith("rule:status:") ? { ...row, text: row.text.replace("30–35", "25–30") } : row);
  let calls = 0;
  const result = await resolveReportSourceConflicts({ evidence: rows, invoke: async () => {
    calls++;
    return { resolutions: ["energy", "protein"].map(nutrient => ({ nutrient, decision: "withhold_numeric",
      selectedSourceId: null, rationale: "The supplied context does not establish a supported priority between the matched targets." })) };
  } });
  expect(calls).toBe(1);
  expect(result.resolutions.map(item => item.nutrient)).toEqual(["energy", "protein"]);
  expect(result.evidence).toHaveLength(evidence.length + 2);
});

test("resolved targets reject mismatched prescriptions across narrative fields and expanded units", async () => {
  const resolved = await resolveReportSourceConflicts({ evidence, invoke: async () => ({ resolutions: [{
    nutrient: "protein", decision: "select_source", selectedSourceId: evidence[2]!.id,
    rationale: "The matched treatment/status target applies to the recorded context.",
  }] }) });
  const narrative = { nutritionAdvice: { text: "Aim for 1.2–1.5 grams per kilogram of body weight per day of protein.", evidenceIds: [] },
    overallSummary: { text: "Take 1 sachet in 150 mL water.", evidenceIds: [] } };
  expect(validateReportTargetResolutions(narrative, resolved.evidence)).toEqual([]);
  expect(validateReportTargetResolutions({ ...narrative, overallSummary: { text: "Aim for 1.5–2.0 g protein/kg/day.", evidenceIds: [] } }, resolved.evidence))
    .toEqual(["overallSummary:RESOLVED_PROTEIN_TARGET_MISMATCH"]);
  expect(validateReportTargetResolutions({ nutritionAdvice: { text: "Aim for 1.5 g/kg/day.", evidenceIds: [] } }, resolved.evidence))
    .toEqual(["nutritionAdvice:RESOLVED_PROTEIN_TARGET_MISMATCH"]);
});

test("withheld targets prohibit numeric prescriptions for that nutrient only", async () => {
  const rows = evidence.map(row => row.id.startsWith("rule:status:") ? { ...row, text: row.text.replace("30–35", "25–30") } : row);
  const resolved = await resolveReportSourceConflicts({ evidence: rows, invoke: async () => ({ resolutions: [
    { nutrient: "energy", decision: "withhold_numeric", selectedSourceId: null, rationale: "Energy targets conflict without evidence supporting a priority." },
    { nutrient: "protein", decision: "withhold_numeric", selectedSourceId: null, rationale: "Protein targets conflict without evidence supporting a priority." },
  ] }) });
  expect(validateReportTargetResolutions({ nutritionAdvice: { text: "Aim for 30 kilocalories per kilogram per day and 1.2 g/kg/day protein.", evidenceIds: [] } }, resolved.evidence))
    .toEqual(["nutritionAdvice:WITHHELD_ENERGY_NUMERIC_TARGET", "nutritionAdvice:WITHHELD_PROTEIN_NUMERIC_TARGET"]);
  expect(validateReportTargetResolutions({ nutritionAdvice: { text: "Your care team will individualise your targets. Take 2 scoops daily.", evidenceIds: [] } }, resolved.evidence)).toEqual([]);
});

test("validation preserves original source evidence and ignores unrelated ordinary doses", () => {
  const snapshot = JSON.stringify(evidence);
  expect(validateReportTargetResolutions({ nutritionAdvice: { text: "1.5 g/kg/day", evidenceIds: [] } }, evidence)).toEqual([]);
  expect(JSON.stringify(evidence)).toBe(snapshot);
});
