import { expect, test } from "bun:test";
import { createReportSectionHighlighter } from "./report-section-highlighter";
import type { ReportWorkerInvoker } from "./report-agent-coordinator";

const selectAll: ReportWorkerInvoker = async (_step, _system, user) => {
  const input = JSON.parse(user);
  return { points: input.points.map((point: {id: string; text: string}) => ({ id: point.id,
    phrases: [{ phrase: point.text.trim(), kind: "warning" }] })) };
};

test("reviews every section point while repairing blanket emphasis", async () => {
  const requests: Array<{section: string; points: Array<{id: string; text: string}>}> = [];
  const highlighter = createReportSectionHighlighter(async (...args) => {
    requests.push(JSON.parse(args[2]));
    return selectAll(...args);
  });
  const warnings = "Call your doctor for fever. Contact your doctor for chest pain. Call for confusion. Contact your doctor for weight gain over 1 kg in a day or breathlessness.";
  const marked = await highlighter.highlight("redFlagsAdvice", warnings);
  expect(requests).toHaveLength(2);
  expect(requests[0]!.section).toBe("redFlagsAdvice");
  expect(requests[0]!.points).toHaveLength(4);
  expect(marked).not.toContain("**Contact your doctor for weight gain over 1 kg in a day or breathlessness.**");
  expect(marked).toContain("or breathlessness");
  expect(marked.replaceAll("**", "")).toBe(warnings);
});

test("reuses unchanged approvals and invalidates only a section whose wording changes", async () => {
  let calls = 0;
  const highlighter = createReportSectionHighlighter(async (...args) => { calls++; return selectAll(...args); });
  const original = "Contact your doctor for fever.";
  expect(await highlighter.highlight("redFlagsAdvice", original)).toContain("**");
  await highlighter.highlight("redFlagsAdvice", original);
  expect(calls).toBe(1);
  const revised = "Contact your oncologist immediately for fever.";
  const marked = await highlighter.highlight("redFlagsAdvice", revised);
  expect(calls).toBe(2);
  expect(marked.replaceAll("**", "")).toBe(revised);
});

test("provider failure cannot block approved text or lose a warning alternative", async () => {
  const highlighter = createReportSectionHighlighter(async () => { throw new Error("provider unavailable"); });
  const text = "Call your doctor for weight gain over 1 kg in a day or breathlessness.";
  const marked = await highlighter.highlight("possible:edema", text);
  expect(marked).not.toContain(`**${text}**`);
  expect(marked).toContain("or breathlessness");
  expect(marked.replaceAll("**", "")).toBe(text);
});

test("rejects rewritten selections and falls back without rewriting approved words", async () => {
  let calls = 0;
  const highlighter = createReportSectionHighlighter(async () => {
    calls++;
    return { points: [{ id: "p1", phrases: [{ phrase: "Take new medicine", kind: "action" }] }] };
  });
  const text = "Contact your doctor for fever.";
  const marked = await highlighter.highlight("redFlagsAdvice", text);
  expect(calls).toBe(2);
  expect(marked).not.toContain("Take new medicine");
  expect(marked.replaceAll("**", "")).toBe(text);
});

test("bounds parallel work and ignores late results from superseded text", async () => {
  let active = 0;
  let peak = 0;
  const highlighter = createReportSectionHighlighter(async (...args) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return selectAll(...args);
  }, 2);
  const texts = ["Call your doctor for fever.", "Call your doctor for chest pain.", "Call your doctor for confusion."];
  const marked = await Promise.all(texts.map(text => highlighter.highlight("same-section", text)));
  expect(peak).toBe(2);
  expect(marked.map(text => text.replaceAll("**", ""))).toEqual(texts);
});


test("settle waits for superseded work as well as the latest section", async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let first = true;
  const highlighter = createReportSectionHighlighter(async (...args) => {
    if (first) { first = false; await gate; }
    return selectAll(...args);
  });
  void highlighter.highlight("same", "Call for fever.");
  await highlighter.highlight("same", "Call for confusion.");
  let settled = false;
  const waiting = highlighter.settle().then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  finish(); await waiting;
  expect(settled).toBe(true);
});

test("invalid repair preserves valid earlier selections in other points", async () => {
  let attempts = 0;
  const highlighter = createReportSectionHighlighter(async () => ++attempts === 1
    ? { points: [{ id: "p1", phrases: [{ phrase: "Track your intake", kind: "action" }] }] }
    : { points: "malformed repair" });
  const result = await highlighter.highlight("monitoring", "Track your intake each day and share changes with the care team. Weigh yourself daily.");
  expect(attempts).toBe(2);
  expect(result).toContain("**Track your intake** each day and share changes");
  expect(result.replaceAll("**", "")).toContain("Weigh yourself daily.");
  expect(result).not.toContain("**Weigh yourself daily.**");
});

test("clinical targets retain their complete units even when the model selects no phrase", async () => {
  const text = "Aim for 30–35 kcal/kg/day and 1.2–1.5 g protein/kg/day. Include suitable protein foods with meals and discuss changes in intake with your care team.";
  const highlighter = createReportSectionHighlighter(async (_step, _system, user) => ({
    points: JSON.parse(user).points.map((point: {id: string}) => ({id:point.id,phrases:[]})),
  }));
  const marked = await highlighter.highlight("nutritionAdvice", text);
  expect(marked).toContain("**30–35 kcal/kg/day**");
  expect(marked).toContain("**1.2–1.5 g protein/kg/day**");
  expect(marked.replaceAll("**", "")).toBe(text);
});

test("batches approved sections four at a time, reuses exact wording and bounds concurrency", async () => {
  let calls = 0, active = 0, peak = 0;
  const batches: number[] = [];
  const highlighter = createReportSectionHighlighter(async (_step, _system, user) => {
    const input = JSON.parse(user);
    calls++; active++; peak = Math.max(peak, active);
    batches.push(input.sections.length);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return {sections: Object.fromEntries(input.sections.map((section: {section: string; points: Array<{id: string}>}) =>
      [section.section, {points: Object.fromEntries(section.points.map(point => [point.id, []]))}]))};
  }, 4);
  const entries = Array.from({length: 9}, (_, index) => ({section: `section:${index}`,
    text: "Aim for 30–35 kcal/kg/day and 1.2–1.5 g protein/kg/day. Include protein foods with meals."}));
  const results = await highlighter.highlightMany(entries);
  expect(batches).toEqual([4, 4, 1]);
  expect(peak).toBe(2);
  for (const entry of entries) {
    expect(results.get(entry.section)?.replaceAll("**", "")).toBe(entry.text);
    expect(results.get(entry.section)).toContain("**30–35 kcal/kg/day**");
    expect(results.get(entry.section)).toContain("**1.2–1.5 g protein/kg/day**");
    await highlighter.highlight(entry.section, entry.text);
  }
  await highlighter.highlightMany(entries);
  expect(calls).toBe(3);
});

test("malformed and missing keyed batch points fall back independently without extra model calls", async () => {
  let calls = 0;
  const highlighter = createReportSectionHighlighter(async () => {
    calls++;
    return {sections: {
      valid: {points: {p1: [{phrase: "Track your intake", kind: "action"}], p2: []}},
      rewrite: {points: {p1: [{phrase: "Take new medicine", kind: "action"}]}},
      collapsed: {points: [{id: "p1", phrases: []}, {id: "p1", phrases: []}]},
    }};
  });
  const text = "Track your intake each day and share any changes with the care team. Keep a daily record of your weight, symptoms, and meals.";
  const entries = ["valid", "rewrite", "collapsed", "missing"].map(section => ({section, text}));
  const results = await highlighter.highlightMany(entries);
  expect(calls).toBe(1);
  expect(results.get("valid")).toContain("**Track your intake**");
  for (const entry of entries) {
    expect(results.get(entry.section)?.replaceAll("**", "")).toBe(text);
    expect(results.get(entry.section)).not.toContain("Take new medicine");
  }
});

test("legacy collapsed section arrays cannot bypass the keyed response contract", async () => {
  let calls = 0;
  const highlighter = createReportSectionHighlighter(async () => {
    calls++;
    return {sections: [{section: "treatmentAdvice", points: [
      {id: "p1", phrases: [{phrase: "Take new medicine", kind: "action"}]},
      {id: "p1", phrases: []}, {id: "p2", phrases: []},
    ]}]};
  });
  const text = "Track your intake each day and share changes with your care team. Contact your doctor if symptoms persist.";
  const entries = ["treatmentAdvice", "redFlagsAdvice"].map(section => ({section, text}));
  const results = await highlighter.highlightMany(entries);
  expect(calls).toBe(1);
  for (const entry of entries) expect(results.get(entry.section)?.replaceAll("**", "")).toBe(entry.text);
});

test("settle waits for batched provider failure and preserves approved text", async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const highlighter = createReportSectionHighlighter(async () => {
    await gate;
    throw new Error("provider unavailable");
  });
  const text = "Aim for 30–35 kcal/kg/day and contact the care team if intake falls.";
  const results = highlighter.highlightMany([{section: "nutritionAdvice", text}]);
  let settled = false;
  const waiting = highlighter.settle().then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  finish();
  const marked = (await results).get("nutritionAdvice")!;
  await waiting;
  expect(settled).toBe(true);
  expect(marked.replaceAll("**", "")).toBe(text);
  expect(marked).toContain("**30–35 kcal/kg/day**");
});


test("batch response schema binds every section to its own exact point keys", async () => {
  let responseSchema: any;
  const highlighter = createReportSectionHighlighter(async (_step, _system, user, schema) => {
    responseSchema = schema;
    const input = JSON.parse(user);
    return {sections: Object.fromEntries(input.sections.map((section: {section: string; points: Array<{id: string}>}) =>
      [section.section, {points: Object.fromEntries(section.points.map(point => [point.id, []]))}]))};
  });
  const entries = [{section: "nutritionAdvice", text: "Aim for 30–35 kcal/kg/day and 1.2–1.5 g protein/kg/day. Include suitable protein foods with meals."},
    {section: "redFlagsAdvice", text: "Contact your care team immediately for a fever and follow its emergency instructions during treatment."}];
  const result = await highlighter.highlightMany(entries);
  const sections = responseSchema.properties.sections;
  expect(sections.type).toBe("object");
  expect(sections.required).toEqual(["nutritionAdvice", "redFlagsAdvice"]);
  expect(sections.additionalProperties).toBe(false);
  const nutrition = sections.properties.nutritionAdvice.properties.points;
  const warnings = sections.properties.redFlagsAdvice.properties.points;
  expect(nutrition.required).toEqual(["p1", "p2"]);
  expect(warnings.required).toEqual(["p1"]);
  expect(Object.keys(nutrition.properties)).toEqual(["p1", "p2"]);
  expect(Object.keys(warnings.properties)).toEqual(["p1"]);
  expect(nutrition.additionalProperties).toBe(false);
  expect(result.get("nutritionAdvice")).toContain("**30–35 kcal/kg/day**");
  expect(result.get("nutritionAdvice")).toContain("**1.2–1.5 g protein/kg/day**");
  expect(result.get("redFlagsAdvice")).toBe(entries[1]!.text);
});
