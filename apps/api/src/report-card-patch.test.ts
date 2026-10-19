import { expect, test } from "bun:test";
import { applyCardPatches } from "./report-card-patch";

const current = [
  {evidenceId: "possible:toxicity:infection", text: "Contact your care team immediately for fever of 100°F (37.8°C) or above. Eat enough protein and energy."},
  {evidenceId: "possible:toxicity:diarrhea", text: "If diarrhea occurs, replace fluid losses with ORS."},
];

test("appending a missing precaution preserves existing warnings, numbers and other cards", () => {
  const result = applyCardPatches(current, {edits: [{
    evidenceId: current[0]!.evidenceId, find: "", replace: "Choose freshly cooked food and avoid raw sprouts.",
  }]});
  expect(result?.[0]?.text).toBe(`${current[0]!.text} Choose freshly cooked food and avoid raw sprouts.`);
  expect(result?.[1]).toEqual(current[1]);
  expect(result?.[0]).not.toBe(current[0]);
  expect(current[0]!.text).not.toContain("raw sprouts");
});

test("a precise card repair changes only its anchored instruction", () => {
  const result = applyCardPatches(current, {edits: [{
    evidenceId: current[0]!.evidenceId, find: "Eat enough protein and energy.",
    replace: "Aim to meet your prescribed protein and energy requirements.",
  }]});
  expect(result?.[0]?.text).toBe("Contact your care team immediately for fever of 100°F (37.8°C) or above. Aim to meet your prescribed protein and energy requirements.");
});

test("an invalid second half of a move rejects the whole transaction without losing card content", () => {
  expect(applyCardPatches(current, {edits: [
    {evidenceId: current[0]!.evidenceId, find: "Eat enough protein and energy.", replace: ""},
    {evidenceId: "possible:toxicity:unknown", find: "", replace: "Eat enough protein and energy."},
  ]})).toBeNull();
  expect(current).toHaveLength(2);
  expect(current[0]!.text).toContain("Eat enough protein and energy.");
});

test("rejects missing or ambiguous anchors, empty appends and malformed transactions", () => {
  for (const edit of [
    {find: "missing instruction", replace: "New text"},
    {find: "", replace: "  "},
    {find: "x".repeat(501), replace: "New text"},
  ]) expect(applyCardPatches(current, {edits: [{evidenceId: current[0]!.evidenceId, ...edit}]})).toBeNull();
  expect(applyCardPatches([{evidenceId: "card", text: "Repeat. Repeat."}], {
    edits: [{evidenceId: "card", find: "Repeat.", replace: "Changed."}],
  })).toBeNull();
  expect(applyCardPatches(current, {rows: current})).toBeNull();
});

test("card edits resolve against the original snapshot when a replacement introduces another anchor", () => {
 const current = [{evidenceId:"possible:x",text:"Keep meals regular. Use pasteurised curd if tolerated. Preserve moist cool foods."}];
 const result = applyCardPatches(current, {edits:[
  {evidenceId:"possible:x", find:"Keep meals regular.",replace:"Have regular meals. Use pasteurised curd if tolerated."},
  {evidenceId:"possible:x",find:"Use pasteurised curd if tolerated.",replace:""},
 ]});
 expect(result?.[0]?.text.replace(/\s+/g," ")).toBe("Have regular meals. Use pasteurised curd if tolerated. Preserve moist cool foods.");
 expect(current[0]!.text).toBe("Keep meals regular. Use pasteurised curd if tolerated. Preserve moist cool foods.");
});

test("card appends preserve input order and cannot become anchors in the same transaction", () => {
 const current = [{evidenceId:"possible:x",text:"Original care."}];
 expect(applyCardPatches(current,{edits:[
  {evidenceId:"possible:x",find:"",replace:"First precaution."},
  {evidenceId:"possible:x",find:"",replace:"Second precaution."},
 ]})?.[0]?.text).toBe("Original care. First precaution. Second precaution.");
 expect(applyCardPatches(current,{edits:[
  {evidenceId:"possible:x",find:"",replace:"New instruction."},
  {evidenceId:"possible:x",find:"New instruction.",replace:"Different instruction."},
 ]})).toBeNull();
});

test("overlapping card ranges reject atomically even if sequential replacement would hide overlap", () => {
 const current=[{evidenceId:"possible:x",text:"Preserve soft moist foods and warnings."}];
 for (const find of ["soft moist foods", "Preserve soft moist foods"]) {
  expect(applyCardPatches(current,{edits:[
   {evidenceId:"possible:x",find:"Preserve soft moist foods",replace:"Choose soft moist foods"},
   {evidenceId:"possible:x",find,replace:"Altered care"},
  ]})).toBeNull();
 }
});
