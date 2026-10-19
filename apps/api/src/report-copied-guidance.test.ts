import { expect, test } from "bun:test";
import { copiedGuidanceFindings } from "./report-copied-guidance";

test("identifies the actual overlap across independent short instructions, with editable anchors", () => {
  const copied = "Increase fibre gradually for constipation when appropriate. Include prebiotic foods such as oats, banana and tolerated vegetables. Modify fermentable foods if bloating occurs. Pasteurised curd";
  const source = "Other source care. " + copied.replace(". ", "; ") + "/yoghurt may be included if tolerated.";
  const text = "Vegetarian protein choices include dal and tofu. " + copied + " or yoghurt may be included if tolerated.";
  const findings = copiedGuidanceFindings(text, [{id: "rule:treatment:test", text: source}]);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.evidenceId).toBe("rule:treatment:test");
  expect(findings[0]!.matchedText).toContain("Increase fibre gradually");
  expect(findings[0]!.sourceQuote).toContain("Include prebiotic foods");
  expect(findings[0]!.anchors).toContain("Modify fermentable foods if bloating occurs.");
  expect(findings[0]!.anchors.some(anchor => anchor.includes("Vegetarian protein"))).toBe(false);
  expect(findings[0]!.anchors.every(anchor => text.includes(anchor) && anchor.length <= 500)).toBe(true);
});

test("retains the complete short-source copying rule and original spelling/numbers", () => {
  const source = "Aim for 25–30 kcal/kg/day and 1.2–1.5 g protein/kg/day, individualised to clinical requirements.";
  const findings = copiedGuidanceFindings(source, [{id: "rule:targets", text: source}]);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.matchedText).toBe(source.slice(0, -1));
  expect(findings[0]!.sourceQuote).toBe(source.slice(0, -1));
  expect(findings[0]!.anchors).toEqual([source]);
});

test("does not report numbers alone or a short clinical phrase from a longer source", () => {
  const source = "Maintain adequate energy and protein. Follow the individually prescribed support plan, and monitor appetite, weight, intake and symptoms. Promptly contact the treating team if urgent symptoms develop.";
  expect(copiedGuidanceFindings("Maintain adequate energy and protein.", [{id: "rule:care", text: source}])).toEqual([]);
  expect(copiedGuidanceFindings("Use 25–30 kcal/kg/day, with 1.2–1.5 g/kg/day protein, based on your individual needs.", [{id: "rule:care", text: source}])).toEqual([]);
  expect(copiedGuidanceFindings("One two three four five six seven.", [{id: "rule:short", text: "One two three four five six seven."}])).toEqual([]);
});

test("keeps distinct source findings and constrains anchors for long sentences", () => {
  const text = Array.from({length: 120}, (_, i) => `word${i}`).join(" ") + ".";
  const findings = copiedGuidanceFindings(text, [{id:"rule:one", text}, {id:"rule:two", text}]);
  expect(findings.map(row => row.evidenceId)).toEqual(["rule:one", "rule:two"]);
  expect(findings.every(row => row.anchors.length > 1 && row.anchors.every(anchor => anchor.length <= 500 && text.includes(anchor)))).toBe(true);
});
