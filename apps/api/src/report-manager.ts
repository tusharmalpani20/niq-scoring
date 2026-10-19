import { reportAdjudicationRecords, REPORT_ADJUDICATION_POLICY, type ReportAdjudication } from "./report-adjudications";
import { buildReportChecklist } from "./report-source-checklist";
import { REPORT_REVIEW_POLICY, ASSEMBLED_REVIEW_STAGE } from "./report-review-policy";
import { resolveReportSourceConflicts, REPORT_TARGET_RESOLUTION_POLICY, validateReportTargetResolutions } from "./report-conflict-resolution";
import { recoverNarrativeSections } from "./report-section-recovery";
import type { ReportNarrative } from "./report-content";
import { CLOSING_SUMMARY_LANGUAGE, NUTRITION_INTERPRETATION_LANGUAGE, SELF_CONTAINED_CARE_LANGUAGE, REPORTED_SYMPTOM_LANGUAGE } from "./report-language-policy";
import { z } from "zod";
import { createReportSectionHighlighter } from "./report-section-highlighter";
import { plainNarrative } from "./report-highlights";
import { coordinateReportAgents } from "./report-agent-coordinator";
import { hasMatchedKidneyCondition, narrativeFieldNames, validateNarrative } from "./report-content";
import { ReportModelError } from "./openrouter-report-client";

type ReportInput = Parameters<typeof coordinateReportAgents>[0];
const decisionSchema = z.object({
  decision: z.enum(["approve", "fallback"]),
  issues: z.array(z.object({ field: z.string(), evidenceIds: z.array(z.string()).max(20),
    reason: z.string().trim().min(1).max(500) }).strict()).max(12),
}).strict();
const decisionJsonSchema = (fields: string[]) => ({ type: "object", additionalProperties: false, required: ["decision", "issues"], properties: {
  decision: { type: "string", enum: ["approve", "fallback"] },
  issues: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["field", "evidenceIds", "reason"], properties: {
    field: { type: "string", enum: fields }, evidenceIds: { type: "array", items: { type: "string" }, maxItems: 20 },
    reason: { type: "string", maxLength: 500 },
  } } },
} });
const managerSystem = `${REPORT_REVIEW_POLICY} ${ASSEMBLED_REVIEW_STAGE} ${REPORT_TARGET_RESOLUTION_POLICY} ${CLOSING_SUMMARY_LANGUAGE} ${NUTRITION_INTERPRETATION_LANGUAGE} ${REPORTED_SYMPTOM_LANGUAGE} ${SELF_CONTAINED_CARE_LANGUAGE} You make the final clinical decision for the exact assembled report supplied. Do not add patient facts, clinical requirements or targets. Independently verify every recorded-symptom care claim against its source heading and triggering condition. A broad symptom does not establish a named condition: do not transfer care from an unmatched symptom/diagnosis merely because it could explain the recorded symptom. This final check is not limited to concerns previously raised by workers. Check the recorded source-conflict resolutions against the evidence; reject a concrete unsafe resolution but do not reopen a supported decision merely to prefer a different wording. Do not demand an artifact absent from this stage's schema. Structured cards already display clinical background and measurements. Required repetition inside complete possible-effect cards is valid. Return approve with no issues only when safe and supported. Otherwise give the precise affected component in field: use a narrative field name for prose, or the exact existing interventionSummaries evidenceId for a card issue. Never route a card omission into narrative prose. Give supporting evidence IDs. Approval never overrides deterministic safety or completeness checks.`;

export class ReportCallBudgetExceeded extends ReportModelError {
  constructor() { super("MODEL_REPORT_CALL_BUDGET"); }
}

/** A report-wide budget bounds nested repairs; optional typography gets its own
 * quota so it cannot spend the clinical review allowance. */
export function createReportCallBudget(invoke: ReportInput["invoke"], clinicalLimit = 36, highlightingLimit = 24) {
  let clinical = 0, highlighting = 0;
  return async (...args: Parameters<ReportInput["invoke"]>) => {
    if (args[0] === "highlighter" ? ++highlighting > highlightingLimit : ++clinical > clinicalLimit)
      throw new ReportCallBudgetExceeded();
    return invoke(...args);
  };
}

/** Sol owns planning and the final decision; Luna workers retain bounded duties.
 * Fixed required stages and deterministic checks cannot be disabled by a plan.
 */
export async function manageReportAgents(input: ReportInput & { sectionFallback?: () => ReportNarrative }) {
  const invoke = createReportCallBudget(input.invoke);
  const resolved = await resolveReportSourceConflicts({ evidence: input.evidence, invoke });
  const checklist = await buildReportChecklist({ evidence: resolved.evidence, invoke });
  // Shared only for this report; recovery must retain earlier judgments.
  const adjudications: ReportAdjudication[] = [];
  const clinicalInput = { ...input, evidence: resolved.evidence, invoke, sourceChecklist: checklist, adjudications };
  const context = { checklist: checklist.checklist, classification: input.classification, evidence: resolved.evidence, targetResolutions: resolved.resolutions,
    hasMatchedKidneyCondition: hasMatchedKidneyCondition(resolved.evidence) };
  const knownIds = new Set(resolved.evidence.map(row => row.id));
  const highlighter = input.highlighter ?? createReportSectionHighlighter(invoke, 2, 0);
  let result = await coordinateReportAgents(clinicalInput);
  let sectionOrigins: Record<string, "agent" | "rule_fallback"> = {};
  let recovered = false;
  const recover = async () => {
    if (recovered || !input.sectionFallback) return false;
    recovered = true;
    let replacement;
    try { replacement = recoverNarrativeSections({ candidate: result.repairCandidate, issueCodes: result.issues,
      fallbackNarrative: input.sectionFallback(), evidence: resolved.evidence }); }
    catch { result = { ...result, issues: [...result.issues, "SECTION_RECOVERY_UNAVAILABLE"] }; return false; }
    if (!replacement.canPreserve || !replacement.replacedFields.length) return false;
    sectionOrigins = replacement.origins as Record<string, "agent" | "rule_fallback">;
    result = await coordinateReportAgents({ ...clinicalInput, initialDraft: replacement.candidate,
      initialInterventionSummaries: result.interventionSummaries });
    return true;
  };
  // Only failed sections are substituted; the merged candidate receives fresh
  // clinical and assembled coverage review before it can issue.
  if (result.status !== "READY") await recover();
  for (let finalRound = 0; finalRound < 2 && result.status === "READY"; finalRound++) {
    const allowedFields = new Set<string>([...narrativeFieldNames, ...result.interventionSummaries.map(row => row.evidenceId)]);
    let rawDecision;
    try { rawDecision = await invoke("manager", `${managerSystem}\n${REPORT_ADJUDICATION_POLICY}`,
      `Make the final report decision. Approve only when the exact issued candidate below is safe, complete and supported. Do not demand possible-effect details again in narrative prose when the matching generated cards cover them. Empty fields are valid when their supported actions have appropriate homes. Full context: ${JSON.stringify({ ...context, adjudications: reportAdjudicationRecords(adjudications, { ...result.narrative,
        ...Object.fromEntries(result.interventionSummaries.map(row => [row.evidenceId, { text: row.text }])) }) })}\nIssued candidate: ${JSON.stringify({ narrative: result.narrative, interventionSummaries: result.interventionSummaries,
        structuredProductPlans: input.guidance.carePlan.products, sectionOrigins })}`, decisionJsonSchema([...allowedFields])); }
    catch (error) {
      if (!(error instanceof ReportModelError)) throw error;
      return { ...result, status: "REVIEW_REQUIRED" as const, issues: [error.code], sectionOrigins, targetResolutions: resolved.resolutions };
    }
    const reviewed = decisionSchema.safeParse(rawDecision);
    if (!reviewed.success || reviewed.data.issues.some(issue => !allowedFields.has(issue.field) || issue.evidenceIds.some(id => !knownIds.has(id))))
      return { ...result, status: "REVIEW_REQUIRED" as const, issues: ["MODEL_INVALID_MANAGER_DECISION"], sectionOrigins, targetResolutions: resolved.resolutions };
    const structural = validateNarrative(plainNarrative(result.narrative), resolved.evidence);
    const finalCheck = { ...structural, issues: [...structural.issues, ...validateReportTargetResolutions(result.narrative, resolved.evidence)] };
    if (reviewed.data.decision === "approve" && !reviewed.data.issues.length && finalCheck.narrative && !finalCheck.issues.length) {
      const narrative = { ...finalCheck.narrative };
      const marked = await highlighter.highlightMany([
        ...narrativeFieldNames.map(field => ({ section: field, text: narrative[field].text })),
        ...result.interventionSummaries.map(row => ({ section: row.evidenceId, text: row.text })),
      ]);
      for (const field of narrativeFieldNames) narrative[field] = { ...narrative[field], text: marked.get(field) ?? narrative[field].text };
      const interventionSummaries = result.interventionSummaries.map(row => ({ ...row,
        text: marked.get(row.evidenceId) ?? row.text }));
      await highlighter.settle();
      return { ...result, narrative, interventionSummaries, sectionOrigins, targetResolutions: resolved.resolutions };
    }
    const managerIssues = reviewed.data.issues.map(issue => `${issue.field}:MANAGER_REVIEW`);
    result = { ...result, status: "REVIEW_REQUIRED", issues: [...new Set([...finalCheck.issues, ...managerIssues,
      ...(!managerIssues.length && !finalCheck.issues.length ? ["MANAGER_REVIEW_UNRESOLVED"] : [])])] };
    if (finalRound === 0 && reviewed.data.issues.length) {
      result = await coordinateReportAgents({ ...clinicalInput, initialDraft: result.repairCandidate,
        initialInterventionSummaries: result.interventionSummaries,
        initialReviewIssues: reviewed.data.issues.filter((issue): issue is typeof issue & {field: typeof narrativeFieldNames[number]} =>
          narrativeFieldNames.some(field => field === issue.field)).map(issue => ({ ...issue, code: "UNCLEAR_WORDING" as const })),
        initialCardReviewIssues: reviewed.data.issues.filter(issue => !narrativeFieldNames.some(field => field === issue.field)) });
      if (result.status !== "READY") await recover();
    }
  }
  return { ...result, sectionOrigins, targetResolutions: resolved.resolutions };
}
