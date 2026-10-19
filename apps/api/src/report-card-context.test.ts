import { expect, test } from "bun:test";
import { reportCardSources } from "./report-card-context";

test("routine nutrition targets do not turn into invented card-specific obligations", () => {
  const evidence = [
    { id: "rule:status:example", text: "Energy and protein\n• Energy 30–35 kcal/kg/day; protein 1.2–1.5 g/kg/day\nSymptom-wise care\n• Mouth sores: soft high-protein foods\n• Contact your care team for fever." },
    { id: "possible:toxicity:infection", text: "Infection risk. Maintain adequate protein and energy. Contact your care team for fever." },
  ];
  const original = structuredClone(evidence);
  const [card] = reportCardSources(evidence);
  expect(card?.text).not.toContain("1.2–1.5");
  expect(card?.text).toContain("soft high-protein foods");
  expect(card?.text).toContain("Contact your care team for fever");
  expect(evidence).toEqual(original);
});

test("an explicit effect-specific numeric instruction is retained", () => {
  const [card] = reportCardSources([{ id: "possible:toxicity:example", text: "If this effect occurs, follow the source target 1.2–1.5 g/kg/day." }]);
  expect(card?.text).toContain("1.2–1.5 g/kg/day");
});
