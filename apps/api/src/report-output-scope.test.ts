import { expect, test } from "bun:test";
import { constrainCoverageOutput, exactRepairAnchors } from "./report-output-scope";
import { coverageJsonSchema } from "./report-coverage";
test("coverage output is constrained to requested rows, not unrelated checklist IDs", () => {
 const schema = constrainCoverageOutput('Source rows: [{"id":"rule:nutrition:x","text":"Care"}]\nComplete report: {}', coverageJsonSchema) as any;
 expect(schema.properties.rows.minItems).toBe(1);
 expect(schema.properties.rows.items.properties.evidenceId.enum).toEqual(["rule:nutrition:x"]);
 expect((coverageJsonSchema as any).properties.rows.items.properties.evidenceId.enum).toBeUndefined();
});
test("repair anchors contain actual sentences and never truncate inside a word", () => {
 const text = "Aim for 25–30 kcal/kg/day. Have 2–3 snacks. Add milk powder or nut butter.";
 const anchors=exactRepairAnchors([text]);
 expect(anchors).toContain("Have 2–3 snacks.");
 expect(anchors.every(anchor=>text.includes(anchor))).toBe(true);
});


test('repeated sentence anchors include unique neighboring context with exact whitespace',()=>{
 const text='Start here.\n\nCorrect documented deficiencies. Keep meals regular.\nCorrect documented deficiencies. End here.';
 const anchors=exactRepairAnchors([text]);
 expect(anchors).not.toContain('Correct documented deficiencies.');
 expect(anchors.filter(anchor=>anchor.includes('Correct documented deficiencies.')).length).toBeGreaterThanOrEqual(2);
 expect(anchors.every(anchor=>text.includes(anchor)&&text.indexOf(anchor)===text.lastIndexOf(anchor)&&anchor.length<=500)).toBe(true);
});
test('preserves simple unique anchors and never supplies ambiguous anchors from another field',()=>{
 const texts=['Try soft foods. Call the care team. Try soft foods.','Try soft foods. Have regular meals.'];
 const anchors=exactRepairAnchors(texts);
 expect(anchors).toContain('Call the care team.');
 expect(anchors).not.toContain('Try soft foods.');
 expect(anchors.every(anchor=>texts.every(text=>!text.includes(anchor)||text.indexOf(anchor)===text.lastIndexOf(anchor)))).toBe(true);
});
test('long sentence chunks stay exact and unique without cutting words',()=>{
 const text=Array.from({length:150},(_,i)=>`word${i}`).join(' ')+'.';
 const anchors=exactRepairAnchors([text]);
 expect(anchors.length).toBeGreaterThan(1);
 expect(anchors.every(anchor=>text.includes(anchor)&&anchor.length<=500)).toBe(true);
});
test('omits an ambiguous repeated anchor when no unique context fits the length limit',()=>{
 const text=Array.from({length:300},()=> 'Repeat this care.').join(' ');
 const anchors=exactRepairAnchors([text]);
 expect(anchors.every(anchor=>text.indexOf(anchor)===text.lastIndexOf(anchor)&&anchor.length<=500)).toBe(true);
});
