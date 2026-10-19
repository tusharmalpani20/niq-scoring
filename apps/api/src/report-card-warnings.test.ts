import { expect, test } from "bun:test";
import { cardWarningIssues } from "./report-card-warnings";

const base = "Conditional class-and-treatment candidate: Fatigue. Source guidance: • Regular meals and snacks, adequate protein and fluids\n• Check for anemia, thyroid dysfunction and dehydration\n• Gentle activity";
const warning = "Persistent vomiting, severe diarrhoea, dehydration, significant swallowing difficulty or severe skin reactions: prompt medical assessment.";
function source(supplemental = warning, effect = base) {
  return `${effect}\nSupplemental matched guidance, ONLY its instructions relevant to this card's effect: ${JSON.stringify([{ id: "rule:treatment:radiation", text: supplemental }])}`;
}

test("assessment of a condition retains its explicit source warning inside the card", () => {
  const issues = cardWarningIssues("Ask your care team to check for anemia, thyroid dysfunction and dehydration.", source());
  expect(issues).toHaveLength(1);
  expect(issues[0]).toContain("dehydration");
  expect(issues[0]).toContain(warning);
});

test("equivalent conditional warning preserves source urgency and assessment", () => {
  for (const text of [
    "Ask your care team to check for anemia, thyroid dysfunction and dehydration. If dehydration develops, seek prompt medical assessment.",
    "If you develop dehydration, ask your doctor to assess you promptly.",
  ]) expect(cardWarningIssues(text, source())).toEqual([]);
});

test("no warning is manufactured without both an assessed condition and matching source warning", () => {
  expect(cardWarningIssues("Eat regularly.", base)).toEqual([]);
  expect(cardWarningIssues("Eat regularly.", source("Severe diarrhoea: prompt medical assessment."))).toEqual([]);
  expect(cardWarningIssues("Eat regularly.", source(warning, "Fatigue. Gentle activity."))).toEqual([]);
  const issues = cardWarningIssues("Eat regularly.", source());
  expect(issues).toHaveLength(1);
  expect(issues[0]).toContain('condition "dehydration"');
  expect(issues[0]).not.toContain('condition "persistent vomiting"');
});

test("routine assessment or a current-condition assertion cannot replace conditional warning", () => {
  for (const text of [
    "The care team should assess dehydration.",
    "If dehydration occurs, ask your care team to assess it.",
    "You have dehydration and need prompt medical assessment.",
    "If dehydration occurs, you do not need prompt medical assessment.",
    "If dehydration occurs, no prompt medical assessment is needed.",
  ]) expect(cardWarningIssues(text, source())).toHaveLength(1);
});

test("source action changes are respected without adding urgent requirements", () => {
  const changed = source("Dehydration: routine medical assessment within 2 days.");
  expect(cardWarningIssues("If dehydration occurs, seek routine medical assessment within 2 days.", changed)).toEqual([]);
  expect(cardWarningIssues("If dehydration occurs, seek prompt medical assessment.", changed)).toHaveLength(1);
  expect(cardWarningIssues("If dehydration occurs, seek routine medical assessment within 3 days.", changed)).toHaveLength(1);
});


test("a specifically named source contact actor cannot be replaced with generic care", () => {
  const specific = source("Dehydration: contact your oncologist immediately.");
  expect(cardWarningIssues("If dehydration occurs, call your oncologist immediately.", specific)).toEqual([]);
  expect(cardWarningIssues("If dehydration occurs, contact a clinician immediately.", specific)).toHaveLength(1);
  expect(cardWarningIssues("If dehydration occurs, contact your care team immediately.", specific)).toHaveLength(1);
});
