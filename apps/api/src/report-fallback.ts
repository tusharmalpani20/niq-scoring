import { narrativeSchema, type ReportContentRequest, type ReportEvidence, type ReportNarrative, matchedReportPacket } from "./report-content";
import { productExceptionActionText } from "@niq-scoring/contracts/product-guidance";

type Packet = ReturnType<typeof matchedReportPacket>;
type Classification = { id: string; label: string };

export class ReportFallbackError extends Error {
  constructor(readonly code: "FALLBACK_SOURCE_INCOMPLETE" | "FALLBACK_CONTENT_TOO_LARGE" | "FALLBACK_SOURCE_CONFLICT") {
    super(code);
  }
}

/**
 * The fallback is a direct presentation of pinned, matched rules. It does not
 * interpret new medical facts or silently shorten a rule when a model fails.
 * Its evidence IDs make omissions detectable without another model call.
 */
export function buildDeterministicReportFallback(input: {
  facts: ReportContentRequest["facts"];
  classification: Classification;
  guidance: Packet;
  evidence: ReportEvidence[];
}): { narrative: ReportNarrative; guidance: Packet & { possibleToxicities: Array<Packet["possibleToxicities"][number] & { summary: string }> } } {
  const { facts, classification, guidance, evidence } = input;
  const evidenceIds = new Set(evidence.map(item => item.id));
  const requireSource = (id: string, value: string) => {
    if (!evidenceIds.has(id) || !value.trim()) throw new ReportFallbackError("FALLBACK_SOURCE_INCOMPLETE");
    return value.trim();
  };
  const part = (rows: Array<{ id: string; text: string }>) => ({
    text: rows.map(row => row.text.trim()).filter(Boolean).join("\n"),
    evidenceIds: rows.filter(row => row.text.trim()).map(row => row.id),
  });

  // A possible class-and-treatment effect is not a symptom reported by this
  // patient. Keep each matched intervention intact in its own conditional card.
  const possibleToxicities = guidance.possibleToxicities.map(row => {
    const id = `possible:toxicity:${row.id}`;
    const intervention = requireSource(id, row.nutritionalInterventions);
    if (!row.expectedToxicity.trim()) throw new ReportFallbackError("FALLBACK_SOURCE_INCOMPLETE");
    return { ...row, summary: `Possible effect: ${row.expectedToxicity.trim()}. If it occurs, follow this matched guidance: ${intervention}` };
  });

  const nutritionRows = guidance.nutritionInterventions.map(row => ({
    id: `rule:nutrition:${row.id}`,
    text: `${row.label}. ${requireSource(`rule:nutrition:${row.id}`, `${row.coreStrategy} ${row.clinicalActions}`)}`,
  }));
  const treatmentRows = [
    ...guidance.classGuidance.map(row => ({ id: `rule:class:${row.id}`,
      text: `${row.label}. ${requireSource(`rule:class:${row.id}`, row.guidance)}` })),
    ...guidance.carePlan.statusModifiers.map(row => ({ id: `rule:status:${row.id}`,
      text: requireSource(`rule:status:${row.id}`, `${row.riskEmphasis} ${row.actions}`) })),
    ...guidance.carePlan.treatmentGuidance.map(row => ({ id: `rule:treatment:${row.id}`,
      text: requireSource(`rule:treatment:${row.id}`, row.guidance) })),
    ...guidance.carePlan.products.notes.map(row => ({ id: `rule:exception:${row.id}`,
      text: `${row.label}. ${requireSource(`rule:exception:${row.id}`, [
        row.action ? productExceptionActionText(row.action) : "", row.guidance,
      ].filter(Boolean).join(" Explanation: "))}` })),
  ];
  const conditionRows = guidance.carePlan.coMorbidities.map(row => ({ id: `rule:comorbidity:${row.id}`,
    text: `${row.label}. ${requireSource(`rule:comorbidity:${row.id}`, row.guidance)}` }));
  const reportedEffectRows = guidance.toxicityInterventions.map(row => ({ id: `rule:toxicity:${row.id}`,
    text: `Clinician-confirmed effect: ${row.expectedToxicity}. ${requireSource(`rule:toxicity:${row.id}`, row.nutritionalInterventions)}` }));
  const fact = (id: string) => evidence.find(row => row.id === id);
  const overviewRows = [fact("fact:diagnosis"), fact("fact:treatment_status"),
    fact("fact:planned_treatment_start"), ...evidence.filter(row => row.id.startsWith("fact:treatment_type_"))]
    .filter((row): row is ReportEvidence => Boolean(row));
  const findingRows = [fact("fact:niq_risk"), fact("fact:weight_direction")]
    .filter((row): row is ReportEvidence => Boolean(row));
  const reportedSymptoms = evidence.filter(row => row.id.startsWith("fact:assessment_") || row.id.startsWith("fact:clinician_toxicity_"));
  const selectedPlan = guidance.carePlan.products.status === "selected"
    ? guidance.carePlan.products.plans.map(row => ({ id: `rule:product:${row.id}`,
      text: `Selected nutrition support: ${row.products}.` })) : [];
  const relevantConditions = guidance.carePlan.coMorbidities.map(row => ({
    id: `rule:comorbidity:${row.id}`, text: `Other condition relevant to nutrition care: ${row.label}.`,
  }));
  const actionLines = [...nutritionRows, ...treatmentRows].flatMap(row => row.text.split(/\n/u)
    .map(text => ({ id: row.id, text: text.trim().replace(/^[•-]\s*/u, "") }))
    .filter(item => /^(?:if\b.{0,120}\b(?:contact|call|tell|discuss|check)|contact|call|tell|discuss|seek)\b/i.test(item.text)));
  const monitoringLines = [...nutritionRows, ...treatmentRows, ...conditionRows].flatMap(row => row.text.split(/\n/u)
    .map(text => ({ id: row.id, text: text.trim().replace(/^[•-]\s*/u, "") }))
    .filter(item => /^(?:monitor|track|check|record|keep track|watch)\b/i.test(item.text)));
  const action = actionLines[0];
  const monitoring = monitoringLines.filter(line => line.text !== action?.text).slice(0, 2);
  const nutritionStrategy = guidance.nutritionInterventions[0]?.coreStrategy.trim()
    ? [{ id: `rule:nutrition:${guidance.nutritionInterventions[0].id}`,
      text: `Matched nutrition strategy: ${guidance.nutritionInterventions[0].coreStrategy.trim()}` }] : [];
  const overallRows = [...overviewRows, ...findingRows, ...nutritionStrategy, ...reportedSymptoms,
    ...relevantConditions, ...selectedPlan, ...(action ? [action] : []), ...monitoring.slice(0, 1)];
  // The closing summary uses explicit recorded facts and matched strategy. It
  // never treats conditional effects as observed symptoms.
  const summary = overallRows.length ? part(overallRows) : part([{
    id: "fact:niq_risk", text: `NIQ risk: ${classification.label}. Reviewed score: ${facts.reviewedScore}.`,
  }]);
  const narrative: ReportNarrative = {
    overview: part(overviewRows),
    keyFindings: part([...findingRows, ...reportedSymptoms]),
    actionSummary: part(action ? [action] : []),
    monitoringSummary: part(monitoring),
    overallSummary: summary,
    nutritionAdvice: part(nutritionRows),
    treatmentAdvice: part(treatmentRows),
    conditionAdvice: part(conditionRows),
    effectsAdvice: part(reportedEffectRows),
  };
  const sectionFor = (id: string): keyof ReportNarrative | "possible" | null => {
    if (id.startsWith("rule:nutrition:")) return "nutritionAdvice";
    if (["rule:class:", "rule:status:", "rule:treatment:", "rule:exception:"].some(prefix => id.startsWith(prefix))) return "treatmentAdvice";
    if (id.startsWith("rule:comorbidity:")) return "conditionAdvice";
    if (id.startsWith("rule:toxicity:")) return "effectsAdvice";
    if (id.startsWith("rule:product:")) return "overallSummary";
    if (id.startsWith("possible:toxicity:")) return "possible";
    return null;
  };
  const possibleIds = new Set(possibleToxicities.map(row => `possible:toxicity:${row.id}`));
  for (const row of evidence) {
    const section = sectionFor(row.id);
    if (section === "possible" ? !possibleIds.has(row.id)
      : section && !narrative[section].evidenceIds.includes(row.id))
      throw new ReportFallbackError("FALLBACK_SOURCE_INCOMPLETE");
  }
  // The source workbook contains generic fixed targets and food examples that
  // can conflict with individually tailored kidney guidance. A mechanical
  // copy cannot resolve that conflict safely, so it cannot issue as fallback.
  const renal = conditionRows.some(row => /\b(?:kidney|renal)\b/i.test(row.text) && /individuali[sz]/i.test(row.text));
  if (renal && [narrative.nutritionAdvice.text, narrative.treatmentAdvice.text,
    ...possibleToxicities.map(row => row.summary)].some(text =>
    /\b\d+(?:\.\d+)?\s*(?:kcal\/kg|g\/kg|L\/day)\b|\b(?:banana|coconut water|potato|spinach|avocado)\b/i.test(text)))
    throw new ReportFallbackError("FALLBACK_SOURCE_CONFLICT");
  if ([...Object.values(narrative).map(row => row.text), ...possibleToxicities.map(row => row.summary)]
    .some(text => /\b(?:hba1c|a1c|glycated\s+ha?emoglobin)\b/i.test(text)))
    throw new ReportFallbackError("FALLBACK_SOURCE_CONFLICT");
  if (Object.values(narrative).some(row => row.text.length > 4000 || row.evidenceIds.length > 100) ||
    possibleToxicities.some(row => row.summary.length > 12000) || !narrativeSchema.safeParse(narrative).success)
    throw new ReportFallbackError("FALLBACK_CONTENT_TOO_LARGE");
  return { narrative, guidance: { ...guidance, possibleToxicities } };
}
