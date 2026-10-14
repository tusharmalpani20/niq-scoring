import { expect, test } from "bun:test";
import { applyNarrativeHighlights, plainNarrative } from "./report-highlights";
import { narrativeFieldNames, type ReportNarrative } from "./report-content";

const narrative = Object.fromEntries(narrativeFieldNames.map(field => [field, {
  text: field === "effectsAdvice" ? "" : "If intake falls, discuss an oral supplement with your care team.",
  evidenceIds: ["supported"],
}])) as ReportNarrative;
const selections = Object.fromEntries(narrativeFieldNames.map(field => [field,
  field === "effectsAdvice" ? [] : ["discuss an oral supplement with your care team"],
]));

test("highlight pass marks reviewed phrases without changing any words or evidence", () => {
  const marked = applyNarrativeHighlights(narrative, selections);
  expect(marked?.nutritionAdvice.text).toBe("If intake falls, **discuss an oral supplement with your care team**.");
  expect(plainNarrative(marked!)).toEqual(narrative);
});

test("highlight pass rejects rewritten, duplicated, overlapping and missing selections", () => {
  for (const invalid of [
    { ...selections, nutritionAdvice: ["start an oral supplement"] },
    { ...selections, nutritionAdvice: ["discuss an oral supplement with your care team", "an oral supplement with your care team"] },
    { ...selections, effectsAdvice: ["discuss an oral supplement with your care team"] },
    { ...selections, nutritionAdvice: ["oral supplement"] },
  ]) expect(applyNarrativeHighlights(narrative, invalid)).toBeNull();
});
