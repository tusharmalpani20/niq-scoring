import { expect, test } from "bun:test";
import { cardPrecautionIssues } from "./report-card-precautions";
import { reportCardSources } from "./report-card-context";

const thyroid = { id: "rule:comorbidity:thyroid", text: "If thyroid medication is being taken, review its timing with the treating clinician. Allow four-hour separation from calcium, iron, multivitamins, antacids, and protein or soy supplements, and at least 30–60 minutes from coffee." };
const probiotic = { id: "rule:treatment:rt", text: "Probiotic supplements require clinical approval, particularly during immunosuppression." };
const source = (base: string, extras = [probiotic]) => reportCardSources([{ id: "possible:toxicity:example", text: base }, ...extras])[0]!.text;

test("requires actual source probiotic approval in an infection card without recommending probiotics", () => {
  const issues = cardPrecautionIssues("Eat adequate protein and energy.", source("Myelosuppression / infection risk"), []);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toContain(probiotic.text);
});

test("requires approval only in relevant cards or positive probiotic recommendations", () => {
  expect(cardPrecautionIssues("Eat small meals.", source("Nausea"), [])).toEqual([]);
  expect(cardPrecautionIssues("Avoid probiotic supplements.", source("Nausea"), [])).toEqual([]);
  expect(cardPrecautionIssues("Include probiotic supplements.", source("Nausea"), [])).toHaveLength(1);
  expect(cardPrecautionIssues("Try probiotic supplements only after your oncology team approves them.", source("Nausea"), [])).toEqual([]);
});

test("absent or negated source precautions never create a requirement", () => {
  expect(cardPrecautionIssues("Try probiotic supplements.", source("Neutropenia", []), [])).toEqual([]);
  const absent = source("Neutropenia", [{ id: "rule:treatment:rt", text: "Probiotic supplements do not require clinical approval." }]);
  expect(cardPrecautionIssues("Eat adequately.", absent, [])).toEqual([]);
  expect(cardPrecautionIssues("Use ONS if needed.", source("Fatigue", []), [])).toEqual([]);
});

test("thyroid source applies to positive nutrition supplements including ONS", () => {
  for (const text of ["Use ONS if intake is inadequate.", "Try oral nutritional supplements.", "Include protein or soy supplements.", "Use protein supplements.", "Use soy supplements."]) {
    const issues = cardPrecautionIssues(text, source("Fatigue", []), [thyroid]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(thyroid.text);
  }
});

test("normal protein foods, negative supplement advice and clinical labels do not trigger timing", () => {
  for (const text of ["Eat protein foods such as dal and tofu.", "Avoid protein supplements.", "Do not use ONS.", "A protein supplement allergy was recorded."]) {
    expect(cardPrecautionIssues(text, source("Fatigue", []), [thyroid])).toEqual([]);
  }
});

test("conditional thyroid timing accepts four hours and 4-hour equivalence", () => {
  for (const timing of ["four hours", "4 hours", "4-hour"]) {
    expect(cardPrecautionIssues(`Use ONS if needed. If you take thyroid medication, keep ${timing} between it and protein or soy supplements, including oral nutrition supplements.`, source("Fatigue", []), [thyroid])).toEqual([]);
  }
});

test("unconditional or incorrect timing remains a precise source-backed finding", () => {
  for (const text of ["Use ONS. Keep four hours between thyroid medication and supplements.", "Use ONS. If taking thyroid medication, keep two hours between it and supplements."]) {
    expect(cardPrecautionIssues(text, source("Fatigue", []), [thyroid])).toHaveLength(1);
  }
});

test("preserves source-specific duration instead of hardcoding four hours or requiring coffee timing", () => {
  const changed = { ...thyroid, text: thyroid.text.replace("four-hour", "six-hour") };
  expect(cardPrecautionIssues("Use ONS. If taking thyroid medication, allow six hours between it and supplements.", source("Fatigue", []), [changed])).toEqual([]);
  expect(cardPrecautionIssues("Use ONS. If taking thyroid medication, allow four hours between it and supplements.", source("Fatigue", []), [changed])).toHaveLength(1);
});

test("a conditional thyroid example in an unrelated rule does not establish matched thyroid care", () => {
  expect(cardPrecautionIssues("Use ONS.", source("Fatigue", []), [{ ...thyroid, id: "rule:treatment:example" }])).toEqual([]);
});

test("unrelated conditions do not turn unconditional thyroid medicine advice into a medication condition", () => {
  expect(cardPrecautionIssues("Use ONS. If needed, keep four hours between thyroid medication and supplements.", source("Fatigue", []), [thyroid])).toHaveLength(1);
});

test("accepts conditional medication use phrased in the passive voice", () => {
  expect(cardPrecautionIssues("Use ONS. When thyroid medicine is being taken, allow four-hour separation from supplements.", source("Fatigue", []), [thyroid])).toEqual([]);
});

test("source units govern timing and equivalent units remain valid", () => {
  const changed = { ...thyroid, text: thyroid.text.replace("four-hour", "90-minute") };
  expect(cardPrecautionIssues("Use ONS. If taking thyroid medication, allow 1.5 hours between it and supplements.", source("Fatigue", []), [changed])).toEqual([]);
});

test("clinical approval may be paraphrased without repeating the word supplements", () => {
  expect(cardPrecautionIssues("Use probiotics only after clinical approval.", source("Neutropenia"), [])).toEqual([]);
});

test("care-team and passive supplement recommendations require matched timing", () => {
  for (const text of ["The care team can provide oral nutrition supplements if intake is low.", "The clinician should offer ONS.", "Start protein supplements.", "Your team may recommend ONS.", "ONS may be used if required."]) {
    expect(cardPrecautionIssues(text, source("Fatigue", []), [thyroid])).toHaveLength(1);
  }
  for (const text of ["Do not provide ONS.", "The care team should not offer ONS.", "ONS should not be used.", "ONS is not recommended."]) {
    expect(cardPrecautionIssues(text, source("Fatigue", []), [thyroid])).toEqual([]);
  }
});

test("negated need for approval cannot satisfy a source approval precaution", () => {
  expect(cardPrecautionIssues("You do not need clinical approval for probiotic supplements.", source("Neutropenia"), [])).toHaveLength(1);
});

test("oral nutrition advice cannot be covered by narrower protein-only timing", () => {
  const text = "If intake stays low, use oral nutrition supplements as directed. If you take thyroid medication, keep protein supplements at least four hours apart from it.";
  expect(cardPrecautionIssues(text, source("Taste changes", []), [thyroid])).toHaveLength(1);
});

test("soy advice cannot be covered by protein-only timing", () => {
  expect(cardPrecautionIssues("Use soy supplements. If taking thyroid medication, keep protein supplements four hours apart from it.", source("Fatigue", []), [thyroid])).toHaveLength(1);
});

test("explicit matching oral scope or unrestricted general supplements covers oral advice", () => {
  for (const timing of ["oral nutrition supplements", "ONS", "supplements", "these supplements", "all supplements", "protein or soy supplements, including oral nutritional supplements"]) {
    expect(cardPrecautionIssues(`Use oral nutrition supplements. If you take thyroid medication, keep ${timing} four hours apart from it.`, source("Fatigue", []), [thyroid])).toEqual([]);
  }
});

test("a protein-only recommendation requires only its own supported timing scope", () => {
  expect(cardPrecautionIssues("Use protein supplements. If taking thyroid medication, keep protein supplements four hours apart from it.", source("Fatigue", []), [thyroid])).toEqual([]);
});

test("medication timing is not itself a positive supplement recommendation", () => {
  expect(cardPrecautionIssues("Avoid oral nutrition supplements. If taking thyroid medication, keep protein supplements four hours apart from it.", source("Fatigue", []), [thyroid])).toEqual([]);
});

test("separate correctly qualified supplement scopes cover each positive recommendation", () => {
  expect(cardPrecautionIssues("Use soy supplements and oral nutrition supplements. If taking thyroid medication, keep soy supplements four hours apart from it. If taking thyroid medication, keep oral nutrition supplements four hours apart from it.", source("Fatigue", []), [thyroid])).toEqual([]);
});

test("naming oral supplements before a narrower timing clause cannot qualify them", () => {
  expect(cardPrecautionIssues("Use oral nutrition supplements, and if you take thyroid medication, keep protein supplements four hours apart from it.", source("Fatigue", []), [thyroid])).toHaveLength(1);
});

test("a source precaution limited to one named supplement type does not invent a rule for another", () => {
  const soyOnly = { ...thyroid, text: thyroid.text.replace("protein or soy supplements", "soy supplements") };
  expect(cardPrecautionIssues("Use protein supplements.", source("Fatigue", []), [soyOnly])).toEqual([]);
});

test("source-equivalent care-team approval avoids an unnecessary card repair", () => {
  for (const actor of ["care team", "care-team", "care–team"]) {
    expect(cardPrecautionIssues(`Probiotic supplements require ${actor} approval, particularly during immunosuppression.`, source("Neutropenia"), [])).toEqual([]);
    expect(cardPrecautionIssues(`Probiotic supplements require approval from your ${actor}, particularly during immunosuppression.`, source("Neutropenia"), [])).toEqual([]);
    expect(cardPrecautionIssues(`Probiotic supplements do not require ${actor} approval, particularly during immunosuppression.`, source("Neutropenia"), [])).toHaveLength(1);
  }
  expect(cardPrecautionIssues("Probiotic supplements require patient approval, particularly during immunosuppression.", source("Neutropenia"), [])).toHaveLength(1);
});

test("coordinated supplement labels cover every named timing scope", () => {
  for (const label of ["oral nutrition and protein supplements", "oral nutritional or soy supplements", "oral nutrient, protein and soy supplements", "oral nutrition, protein, and soy supplements", "protein and soy supplements"]) {
    const recommended = label.startsWith("protein") ? "Use soy supplements." : "Use ONS.";
    expect(cardPrecautionIssues(`${recommended} If you take thyroid medication, separate ${label} from it by four hours.`, source("Taste changes", []), [thyroid])).toEqual([]);
  }
});

test("a coordinated recommendation cannot hide oral scope behind protein-only timing", () => {
  expect(cardPrecautionIssues("Use oral nutrition and protein supplements. If taking thyroid medication, keep protein supplements four hours apart from it.", source("Fatigue", []), [thyroid])).toHaveLength(1);
});

test("coordinated timing still requires the correct interval and medication condition", () => {
  for (const text of [
    "Use ONS. Keep oral nutrition and protein supplements four hours apart from thyroid medication.",
    "Use ONS. If taking thyroid medication, keep oral nutrition and protein supplements two hours apart from it.",
    "Use oral nutrition supplements. If taking thyroid medication, keep protein and soy supplements four hours apart from it.",
  ]) expect(cardPrecautionIssues(text, source("Fatigue", []), [thyroid])).toHaveLength(1);
  expect(cardPrecautionIssues("Avoid oral nutrition and protein supplements.", source("Fatigue", []), [thyroid])).toEqual([]);
  expect(cardPrecautionIssues("Use ONS. If taking thyroid medication, keep protein foods and soy milk four hours apart from it.", source("Fatigue", []), [thyroid])).toHaveLength(1);
  expect(cardPrecautionIssues("Use oral nutrition supplements and protein foods. If taking thyroid medication, keep oral nutrition supplements four hours apart from it.", source("Fatigue", []), [thyroid])).toEqual([]);
});
