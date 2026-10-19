import { expect, test } from "bun:test";
import { foodQualificationIssues } from "./report-food-qualification";

const source = "General advice: Pasteurised curd/yoghurt may be included if tolerated. Probiotic supplements require clinical approval.";

test("requires the matched source's dairy qualifications in each relevant card", () => {
  const issues = foodQualificationIssues("Try curd rice and soft foods.", source);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toContain("pasteurised");
  expect(issues[0]).toContain("if tolerated");
  expect(issues[0]).toContain("Pasteurised curd/yoghurt may be included if tolerated.");
});

test("accepts equivalent spelling and locally qualified recommendations", () => {
  for (const text of ["If tolerated, choose pasteurized yogurt.", "Try pasteurised curd rice if you tolerate it.",
    "Choose curd made from pasteurised milk if tolerated.", "If well tolerated, include pasteurized yoghurt and soft foods.",
    "Curd or yoghurt may be included if pasteurised and tolerated."]) {
    expect(foodQualificationIssues(text, source)).toEqual([]);
  }
});

test("does not invent qualifications absent from the matched source", () => {
  expect(foodQualificationIssues("Choose curd rice.", "Try curd rice and banana.")).toEqual([]);
  expect(foodQualificationIssues("Choose pasteurised curd.", "Choose pasteurised curd.")).toEqual([]);
  expect(foodQualificationIssues("Choose curd if tolerated.", "Curd may be included if tolerated.")).toEqual([]);
  expect(foodQualificationIssues("Choose curd.", "Avoid unpasteurised yoghurt.")).toEqual([]);
});

test("preserves negative restrictions without requiring a positive food preparation", () => {
  for (const text of ["Avoid curd and yoghurt.", "Do not eat yogurt.", "Choose food without curd.", "Avoid unpasteurised yoghurt."]) {
    expect(foodQualificationIssues(text, source)).toEqual([]);
  }
  expect(foodQualificationIssues("Avoid curd, but choose yoghurt.", source)).toHaveLength(1);
  expect(foodQualificationIssues("Avoid curd and choose yoghurt.", source)).toHaveLength(1);
});

test("checks every dairy recommendation rather than accepting a qualified shared sentence", () => {
  expect(foodQualificationIssues("Choose pasteurised curd if tolerated. For diarrhea, try curd rice.", source)).toHaveLength(1);
  expect(foodQualificationIssues("Choose banana and rice.", source)).toEqual([]);
  expect(foodQualificationIssues("Choose unpasteurised curd if tolerated.", source)[0]).toContain("pasteurised");
});

test("reads encoded supplemental source rows without leaking unrelated guidance into findings", () => {
  const supplemental = `Soft foods include curd rice.\nSupplemental matched guidance, ONLY its instructions relevant to this card's effect: ${JSON.stringify([{ id: "rule:treatment:example", text: "Regular meals and snacks.\nPasteurised curd/yoghurt may be included if tolerated." }])}`;
  const issues = foodQualificationIssues("Choose curd rice.", supplemental);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toContain("Pasteurised curd/yoghurt may be included if tolerated.");
  expect(issues[0]).not.toContain("Regular meals");
  expect(issues[0]).not.toContain("rule:treatment");
});

test("negated tolerance cannot satisfy the positive source qualification", () => {
  expect(foodQualificationIssues("Choose pasteurised curd if not tolerated.", source)[0]).toContain("if tolerated");
  expect(foodQualificationIssues("Choose curd if pasteurised and not tolerated.", source)[0]).toContain("if tolerated");
  expect(foodQualificationIssues("Choose curd if pasteurised and tolerated.", source)).toEqual([]);
  expect(foodQualificationIssues("Choose curd if tolerated.", source)[0]).toContain("pasteurised");
});
