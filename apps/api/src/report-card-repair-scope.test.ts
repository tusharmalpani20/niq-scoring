import { expect, test } from "bun:test";
import { cardPatchJsonSchema } from "./report-card-patch";
import { constrainCardRepair } from "./report-output-scope";

const cards = [
  {evidenceId: "possible:toxicity:mouth", text: "Choose soft, cool foods such as curd. Use a soft toothbrush."},
  {evidenceId: "possible:toxicity:fatigue", text: "Have regular meals. Try gentle activity."},
];
function finds(schema: Record<string, unknown>, id: string): string[] {
  const branches = (schema as any).properties.edits.items.anyOf;
  return branches.find((branch: any) => branch.properties.evidenceId.enum[0] === id)?.properties.find.enum ?? [];
}

test("positive curd qualification corrections must replace existing card wording", () => {
  const scoped = constrainCardRepair(cards, [{id: cards[0]!.evidenceId, missing: ["Qualify the positive curd recommendation as pasteurised and only if tolerated."]}], cardPatchJsonSchema);
  expect(finds(scoped, cards[0]!.evidenceId)).not.toContain("");
  expect(finds(scoped, cards[0]!.evidenceId)).toContain("Choose soft, cool foods such as curd.");
  // A separate qualified sentence cannot correct the earlier unqualified advice.
  expect(finds(scoped, cards[0]!.evidenceId).includes("")).toBe(false);
});

test("semantic repetition corrections cannot append another statement", () => {
  const scoped = constrainCardRepair(cards, [{id: cards[1]!.evidenceId, missing: ["Consolidate the overlapping meal and activity instructions without losing their conditions."]}], cardPatchJsonSchema);
  expect(finds(scoped, cards[1]!.evidenceId)).not.toContain("");
  expect(finds(scoped, cards[1]!.evidenceId)).toContain("Have regular meals.");
});

test("missing-only source care can append to its owning card", () => {
  const scoped = constrainCardRepair(cards, [{id: cards[1]!.evidenceId, missing: ["Include contact with your doctor for severe fatigue."]}], cardPatchJsonSchema);
  expect(finds(scoped, cards[1]!.evidenceId)).toContain("");
});

test("anchors bind to their own card rather than another card", () => {
  const scoped = constrainCardRepair(cards, [], cardPatchJsonSchema);
  expect(finds(scoped, cards[0]!.evidenceId)).not.toContain("Have regular meals.");
  expect(finds(scoped, cards[1]!.evidenceId)).not.toContain("Use a soft toothbrush.");
  expect((cardPatchJsonSchema as any).properties.edits.items.properties.find.enum).toBeUndefined();
});

test.each(["Remove the duplicated instruction.", "Replace the unsafe existing advice.", "SOURCE_FOOD_QUALIFICATION:curd/yoghurt: retain pasteurisation.", "REPEATED_SENTENCE: keep one occurrence.", "The timing precaution uses a narrower supplement type."])("known existing-text issue requires an anchor: %s", reason => {
  const scoped = constrainCardRepair(cards, [{id: cards[0]!.evidenceId, missing: [reason]}], cardPatchJsonSchema);
  expect(finds(scoped, cards[0]!.evidenceId)).not.toContain("");
  expect(finds(scoped, cards[1]!.evidenceId)).toContain("");
});

test("repeated text within one card uses unique neighboring context", () => {
  const current = [{evidenceId: "possible:toxicity:one", text: "Start here. Eat small meals. End here. Eat small meals."}];
  const scoped = constrainCardRepair(current, [{id: current[0]!.evidenceId, missing: ["Remove repeated advice."]}], cardPatchJsonSchema);
  expect(finds(scoped, current[0]!.evidenceId)).not.toContain("Eat small meals.");
  expect(finds(scoped, current[0]!.evidenceId).some(anchor => anchor.includes("Eat small meals."))).toBe(true);
});
