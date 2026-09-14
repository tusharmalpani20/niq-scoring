import { describe, expect, test } from 'bun:test';
import { blankRuleDefinition } from '@niq-scoring/contracts/rules';
import { optionPoints, scoringReferences, synchronizeOptionPoints } from '../src/rules/scoring-model';
describe('scoring edit references',()=>{
 test('protects domains and classifications used by rules and sample expectations',()=>{
 const d=blankRuleDefinition('Test');
 d.scoring=[{id:'score',label:'Score',domainId:'domain',sources:[],kind:'condition',when:{match:'all',tests:[{ref:{kind:'question',id:'question'},operator:'answered'}]},points:1,otherwise:0}];
 d.interventions=[{id:'intervention',label:'Guidance',kind:'note',text:'Example',sources:[],priority:0,exclusiveGroup:null,when:{match:'all',tests:[{ref:{kind:'classification',id:'classification'},operator:'eq',value:'low'}]}}];
 d.samples=[{id:'sample',name:'Baseline',answers:{},expected:{complete:true,score:0,classificationId:'low',interventionIds:['intervention'],domains:{domain:0},calculations:{}}}];
 expect(scoringReferences(d,'domain','domain')).toEqual(['Score','Sample: Baseline']);
 expect(scoringReferences(d,'classification','low')).toEqual(['Guidance','Sample: Baseline']);
 expect(scoringReferences(d,'intervention','intervention')).toEqual(['Sample: Baseline']);
 expect(scoringReferences(d,'domain','unused')).toEqual([]);
 });
 test('option point initialization covers every current option without inventing points',()=>{
 const d=blankRuleDefinition('Test');
 d.sections=[{id:'section',title:'Section',description:'',questions:[{id:'question',label:'Question',type:'single_select',purpose:'scoring',help:'',unit:'',required:false,validation:{},visibleWhen:null,sources:[],options:[{id:'yes',label:'Yes',help:''},{id:'no',label:'No',help:''}]}]}];
 expect(optionPoints(d,'question')).toEqual([{optionId:'yes',points:0},{optionId:'no',points:0}]);
 expect(optionPoints(d,'unknown')).toEqual([]);
 expect(synchronizeOptionPoints(d,{id:'rule',label:'Rule',sources:[],domainId:'domain',kind:'options',questionId:'question',aggregation:'sum',cap:null,points:[{optionId:'yes',points:4},{optionId:'deleted',points:9}]})).toEqual([{optionId:'yes',points:4},{optionId:'no',points:0}]);
 });
});
