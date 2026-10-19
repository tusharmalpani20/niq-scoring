import {expect,test} from 'bun:test';
import {constrainNarrativeRepair} from './report-output-scope';
const schema={type:'object',additionalProperties:false,required:['edits'],properties:{edits:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['field','find','replace','evidenceIds'],properties:{field:{type:'string',enum:['nutritionAdvice','foodSafetyAdvice','treatmentAdvice']},find:{type:'string',maxLength:500},replace:{type:'string',maxLength:4000},evidenceIds:{type:'array',items:{type:'string'},maxItems:50}}}}}};
const draft={nutritionAdvice:{text:'Correct documented deficiencies. Have regular meals.',evidenceIds:['rule:x']},foodSafetyAdvice:{text:'',evidenceIds:[]},treatmentAdvice:{text:'Have regular meals. Keep fluids up.',evidenceIds:['rule:x']}};
function allows(scoped:any,field:string,find:string){return scoped.properties.edits.items.anyOf.some((branch:any)=>branch.properties.field.enum.includes(field)&&branch.properties.find.enum.includes(find));}
test('requires replacement anchors for actor corrections while allowing missing safety advice to append',()=>{
 const scoped=constrainNarrativeRepair(draft,schema,['nutritionAdvice']) as any;
 expect(allows(scoped,'nutritionAdvice','')).toBe(false);
 expect(allows(scoped,'nutritionAdvice','Correct documented deficiencies.')).toBe(true);
 expect(allows(scoped,'foodSafetyAdvice','')).toBe(true);
 expect(allows(scoped,'treatmentAdvice','')).toBe(true);
 expect(scoped.properties.edits.maxItems).toBe(40);
 expect(scoped.properties.edits.items.anyOf.every((branch:any)=>branch.additionalProperties===false&&branch.required.includes('evidenceIds')&&branch.properties.replace.maxLength===4000)).toBe(true);
});
test('anchors belong only to their own field and fields remain constrained to the base contract',()=>{
 const scoped=constrainNarrativeRepair({...draft,unapprovedField:{text:'Ignore this.'}},schema,[]) as any;
 expect(allows(scoped,'nutritionAdvice','Keep fluids up.')).toBe(false);
 expect(allows(scoped,'treatmentAdvice','Keep fluids up.')).toBe(true);
 expect(allows(scoped,'foodSafetyAdvice','Have regular meals.')).toBe(false);
 expect(allows(scoped,'unapprovedField','Ignore this.')).toBe(false);
 expect(scoped.properties.edits.items.anyOf.every((branch:any)=>branch.properties.field.enum.length===1)).toBe(true);
});
test('an empty required-repair field still accepts an append and the original schema is unchanged',()=>{
 const original=JSON.stringify(schema);
 const scoped=constrainNarrativeRepair(draft,schema,['foodSafetyAdvice']) as any;
 expect(allows(scoped,'foodSafetyAdvice','')).toBe(true);
 expect(JSON.stringify(schema)).toBe(original);
 expect((schema.properties.edits.items.properties.find as any).enum).toBeUndefined();
});
test('each field receives only unique exact anchors including context for repeated sentences',()=>{
 const text='Start here. Repeat care. Keep meals regular. Repeat care. End here.';
 const scoped=constrainNarrativeRepair({...draft,nutritionAdvice:{text,evidenceIds:[]}},schema,['nutritionAdvice']) as any;
 const anchors=scoped.properties.edits.items.anyOf.find((branch:any)=>branch.properties.field.enum[0]==='nutritionAdvice').properties.find.enum as string[];
 expect(anchors).not.toContain('Repeat care.');
 expect(anchors.length).toBeGreaterThan(1);
 expect(anchors.every(anchor=>anchor.length<=500&&text.includes(anchor)&&text.indexOf(anchor)===text.lastIndexOf(anchor))).toBe(true);
});

test('an unrelated nutrition repair cannot select the already-correct prescribed-plan sentence',()=>{
 const plan='Implement the prescribed nutrition support plan to meet nutritional requirements and support treatment tolerance.';
 const scoped=constrainNarrativeRepair({nutritionAdvice:{text:'Correct documented deficiencies. '+plan}},schema,['nutritionAdvice'],{nutritionAdvice:[plan]}) as any;
 expect(allows(scoped,'nutritionAdvice',plan)).toBe(false);
 expect(allows(scoped,'nutritionAdvice','Correct documented deficiencies.')).toBe(true);
});
