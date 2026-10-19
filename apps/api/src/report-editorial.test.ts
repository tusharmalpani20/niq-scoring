import {expect,test} from "bun:test";
import {reportEditorialFindings,PRESCRIBED_PLAN_SENTENCE} from "./report-editorial";
test("internal rule language is rejected in warnings as well as interpretations",()=>{
 const findings=reportEditorialFindings({redFlagsAdvice:{text:"The matched alkylating-agent guidance also advises immediate contact for fever."}});
 expect(findings).toHaveLength(1);expect(findings[0]!.field).toBe("redFlagsAdvice");expect(findings[0]!.code).toBe("INTERNAL_WORKFLOW_WORDING");
 expect(reportEditorialFindings({redFlagsAdvice:{text:"Contact your oncologist immediately for fever. Follow your care team's guidance."}})).toEqual([]);
});
test("a repeated supported plan recommendation does not block issuing",()=>{
 const findings=reportEditorialFindings({nutritionAdvice:{text:PRESCRIBED_PLAN_SENTENCE},actionSummary:{text:PRESCRIBED_PLAN_SENTENCE}});
 expect(findings).toEqual([]);
 expect(reportEditorialFindings({nutritionAdvice:{text:PRESCRIBED_PLAN_SENTENCE},actionSummary:{text:"Arrange your next nutrition review with the care team."}})).toEqual([]);
});
test("harmless repeated recommendations within or across passages are nonblocking",()=>{
 const warning="Contact your oncologist immediately for fever during treatment.";
 expect(reportEditorialFindings({redFlagsAdvice:{text:warning+" "+warning}})).toEqual([]);
 expect(reportEditorialFindings({redFlagsAdvice:{text:warning},treatmentAdvice:{text:warning}})).toEqual([]);
 expect(reportEditorialFindings({conditionAdvice:{text:"### First condition\n"+warning+"\n### Second condition\n"+warning}})).toEqual([]);
});

test("source commentary is replaced with direct warning instructions",()=>{
 for(const text of ["The sources give different fever thresholds.","The status guidance also says to contact your oncologist.","These thresholds differ; ask your oncology team which to follow."])
  expect(reportEditorialFindings({redFlagsAdvice:{text}}).map(x=>x.code)).toContain("INTERNAL_WORKFLOW_WORDING");
 const direct="Contact your oncologist immediately for a temperature of 100°F (37.8°C) or above. During treatment, contact the oncology team for a fever of 38°C (100.4°F) or above and follow its emergency instructions.";
 expect(reportEditorialFindings({redFlagsAdvice:{text:direct}})).toEqual([]);
});

test("malformed writer values remain schema errors instead of crashing editorial diagnostics",()=>{
  expect(reportEditorialFindings({actionSummary:{text:42},nutritionAdvice:{text:null}} as any)).toEqual([]);
});
