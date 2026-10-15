import { expect, test } from "bun:test";
import { createReportSectionHighlighter } from "./report-section-highlighter";
import type { ReportWorkerInvoker } from "./report-agent-coordinator";

const selectAll: ReportWorkerInvoker = async (_step, _system, user) => {
  const input = JSON.parse(user);
  return { points: input.points.map((point: {id: string; text: string}) => ({ id: point.id,
    phrases: [{ phrase: point.text.trim(), kind: "warning" }] })) };
};

test("highlights each section separately, including every warning after the third point", async () => {
  const requests: Array<{section: string; points: Array<{id: string; text: string}>}> = [];
  const highlighter = createReportSectionHighlighter(async (...args) => {
    requests.push(JSON.parse(args[2]));
    return selectAll(...args);
  });
  const warnings = "Call your doctor for fever. Contact your doctor for chest pain. Call for confusion. Contact your doctor for weight gain over 1 kg in a day or breathlessness.";
  const marked = await highlighter.highlight("redFlagsAdvice", warnings);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.section).toBe("redFlagsAdvice");
  expect(requests[0]!.points).toHaveLength(4);
  expect(marked).toContain("**Contact your doctor for weight gain over 1 kg in a day or breathlessness.**");
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
  expect(marked).toContain("**");
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
  expect(marked).toContain("**");
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
