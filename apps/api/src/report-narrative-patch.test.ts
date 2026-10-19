import { expect, test } from "bun:test";
import { applyNarrativePatches } from "./report-narrative-patch";
const draft = { nutritionAdvice: { text: "Aim for 25–30 kcal/kg/day. Have 2–3 snacks.", evidenceIds: ["rule:nutrition:x"] }, treatmentAdvice: { text: "Choose prebiotic foods. Follow prescribed skin care.", evidenceIds: ["rule:treatment:x"] } };
const known = new Set(["rule:nutrition:x", "rule:treatment:x"]);
test("moves one instruction atomically while preserving targets, snacks and unrelated care", () => {
 const result = applyNarrativePatches(draft, { edits: [
  { field: "treatmentAdvice", find: "Choose prebiotic foods. ", replace: "", evidenceIds: [] },
  { field: "nutritionAdvice", find: "", replace: "Choose prebiotic foods.", evidenceIds: ["rule:treatment:x"] },
 ] }, known);
 expect(result?.nutritionAdvice.text).toBe("Aim for 25–30 kcal/kg/day. Have 2–3 snacks. Choose prebiotic foods.");
 expect(result?.treatmentAdvice.text).toBe("Follow prescribed skin care.");
 expect(draft.treatmentAdvice.text).toContain("Choose prebiotic foods.");
});
test("rejects the whole patch for an ambiguous anchor or unknown evidence", () => {
 expect(applyNarrativePatches(draft, { edits: [{ field: "nutritionAdvice", find: "missing", replace: "Invented advice", evidenceIds: [] }] }, known)).toBeNull();
 expect(applyNarrativePatches(draft, { edits: [{ field: "nutritionAdvice", find: "", replace: "Invented advice", evidenceIds: ["unknown"] }] }, known)).toBeNull();
});

test("can append supported care to an omitted optional safety field", () => {
 const result = applyNarrativePatches(draft, { edits: [{ field: "foodSafetyAdvice", find: "", replace: "Choose freshly cooked food.", evidenceIds: ["rule:treatment:x"] }] }, known);
 expect((result as any)?.foodSafetyAdvice.text).toBe("Choose freshly cooked food.");
});

const knownSnapshot=new Set(['rule:care']);
test('edits refer to the original snapshot even when a replacement introduces a later anchor',()=>{
 const draft={nutritionAdvice:{text:'Combine meals and support. Fortify food if needed. Keep fluids up.',evidenceIds:['rule:care']}};
 const result=applyNarrativePatches(draft,{edits:[
  {field:'nutritionAdvice',find:'Combine meals and support.',replace:'Regular meals. Fortify food if needed.',evidenceIds:['rule:care']},
  {field:'nutritionAdvice',find:'Fortify food if needed.',replace:'',evidenceIds:[]},
 ]},knownSnapshot);
 expect(result?.nutritionAdvice.text.replace(/\s+/g,' ')).toBe('Regular meals. Fortify food if needed. Keep fluids up.');
 expect(draft.nutritionAdvice.text).toBe('Combine meals and support. Fortify food if needed. Keep fluids up.');
});
test('appends keep input order and are never eligible for another edit in the same transaction',()=>{
 const draft={nutritionAdvice:{text:'Existing care.',evidenceIds:['rule:care']}};
 expect(applyNarrativePatches(draft,{edits:[
  {field:'nutritionAdvice',find:'',replace:'First appended care.',evidenceIds:['rule:care']},
  {field:'nutritionAdvice',find:'',replace:'Second appended care.',evidenceIds:['rule:care']},
 ]},knownSnapshot)?.nutritionAdvice.text).toBe('Existing care. First appended care. Second appended care.');
 expect(applyNarrativePatches(draft,{edits:[
  {field:'nutritionAdvice',find:'',replace:'New anchor.',evidenceIds:['rule:care']},
  {field:'nutritionAdvice',find:'New anchor.',replace:'Altered care.',evidenceIds:['rule:care']},
 ]},knownSnapshot)).toBeNull();
});
test('overlapping or duplicate original ranges reject the whole transaction',()=>{
 const draft={nutritionAdvice:{text:'Preserve the care and warning.',evidenceIds:['rule:care']}};
 for(const find of ['care','Preserve the care']) expect(applyNarrativePatches(draft,{edits:[
  {field:'nutritionAdvice',find:'Preserve the care',replace:'New care',evidenceIds:['rule:care']},
  {field:'nutritionAdvice',find,replace:'Changed',evidenceIds:['rule:care']},
 ]},knownSnapshot)).toBeNull();
});

test("an unrelated repair cannot remove an explicitly protected instruction",()=>{
 const plan="Implement the prescribed nutrition support plan to meet nutritional requirements and support treatment tolerance.";
 const original={nutritionAdvice:{text:"Correct documented deficiencies. "+plan,evidenceIds:["rule:nutrition:x"]}};
 const patches={edits:[{field:"nutritionAdvice",find:plan,replace:"The care team should implement this plan.",evidenceIds:["rule:nutrition:x"]}]};
 expect(applyNarrativePatches(original,patches,known,{nutritionAdvice:[plan]})).toBeNull();
 expect(original.nutritionAdvice.text).toContain(plan);
 expect(applyNarrativePatches(original,{edits:[{field:"nutritionAdvice",find:"Correct documented deficiencies.",replace:"The care team should correct documented deficiencies.",evidenceIds:["rule:nutrition:x"]}]},known,{nutritionAdvice:[plan]})?.nutritionAdvice.text).toContain(plan);
});
