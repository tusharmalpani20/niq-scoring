import { narrativeSchema, type ReportContentRequest, type ReportEvidence, type ReportNarrative, type CompleteReportNarrative, matchedReportPacket } from "./report-content";
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
    text: [...new Map(rows.filter(row => row.text.trim()).map(row =>
      [row.text.trim().toLocaleLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, ""), row.text.trim()])).values()].join("\n"),
    evidenceIds: [...new Set(rows.filter(row => row.text.trim()).map(row => row.id))],
  });

  // The model is the primary partitioner. This conservative sentence-level
  // fallback keeps safety clauses in the dedicated sections without losing
  // the original source evidence ID.
  const partition = (rows: Array<{ id: string; text: string }>) => {
    const advice: typeof rows = [], foodSafety: typeof rows = [], redFlags: typeof rows = [];
    for (const row of rows) {
      const sentences = row.text.split(/\n|•\s*|(?<=[!?])\s+|(?<!\d)\.(?!\d)\s+/u).map(text => text.trim()).filter(Boolean);
      for (const text of sentences) {
        if (/\bask\b.{0,70}\b(?:oral nutrition(?:al)? supplements?|(?:DM|diabet(?:es|ic)) supplements?)\b/i.test(text)) continue;
        const item = { id: row.id, text };
        if (/\b(?:food safety|freshly cooked|washed and peeled|washed\/peeled|boiled water|unpasteuri[sz]ed|raw sprouts|street food|leftovers?|food hygiene)\b/i.test(text)) foodSafety.push(item);
        else if (/\b(?:red[- ]flag|urgent(?:ly)?|immediately|emergency|fever|chills|contact|call|inform .*same day|inform (?:the |your )?doctor|very low BP|seek (?:urgent|medical)|report persistent|threshold)\b/i.test(text)) redFlags.push(item);
        else advice.push(item);
      }
    }
    return { advice, foodSafety, redFlags };
  };

  // A possible class-and-treatment effect is not a symptom reported by this
  // patient. Keep each matched intervention intact in its own conditional card.
  const possibleSafety = partition(guidance.possibleToxicities.map(row => ({
    id: `possible:toxicity:${row.id}`, text: row.nutritionalInterventions,
  })));
  const possibleToxicities = guidance.possibleToxicities.map(row => {
    const id = `possible:toxicity:${row.id}`;
    requireSource(id, row.nutritionalInterventions);
    if (!row.expectedToxicity.trim()) throw new ReportFallbackError("FALLBACK_SOURCE_INCOMPLETE");
    const intervention = possibleSafety.advice.filter(item => item.id === id).map(item => item.text).join(". ");
    return { ...row, summary: `Possible effect: ${row.expectedToxicity.trim()}.${intervention ? ` If it occurs, follow this matched guidance: ${intervention}` : ""}` };
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
    ...guidance.carePlan.products.notes.filter(row => row.action?.type !== "remove").map(row => ({ id: `rule:exception:${row.id}`,
      text: `${row.label}. ${requireSource(`rule:exception:${row.id}`, [
        row.action ? productExceptionActionText(row.action) : "", row.guidance,
      ].filter(Boolean).join(" Explanation: "))}` })),
  ];
  const conditionRows = guidance.carePlan.coMorbidities.map(row => ({ id: `rule:comorbidity:${row.id}`,
    text: `${row.label}. ${requireSource(`rule:comorbidity:${row.id}`, row.guidance)}` }));
  const reportedEffectRows = guidance.toxicityInterventions.map(row => ({ id: `rule:toxicity:${row.id}`,
    text: `${facts.confirmedToxicityIds.includes(row.id) ? "Clinician-confirmed effect" : "Reported effect"}: ${row.expectedToxicity}. ${requireSource(`rule:toxicity:${row.id}`, row.nutritionalInterventions)}` }));
  const partitions = partition([...nutritionRows, ...treatmentRows, ...conditionRows, ...reportedEffectRows,
    ...guidance.possibleToxicities.map(row => ({ id: `possible:toxicity:${row.id}`, text: row.nutritionalInterventions }))]);
  const nutritionContent = partition(nutritionRows).advice;
  const treatmentContent = partition(treatmentRows).advice;
  const conditionContent = partition(conditionRows).advice;
  const effectContent = partition(reportedEffectRows).advice;
  const fact = (id: string) => evidence.find(row => row.id === id);
  const findingRows = [fact("fact:nutritional_status")]
    .filter((row): row is ReportEvidence => Boolean(row))
    .map(row => ({ ...row, text: row.text.replace("Nutritional status for this risk category:", "Nutritional status:") }));
  const reportedSymptoms = evidence.filter(row => row.id.startsWith("fact:assessment_") || row.id.startsWith("fact:clinician_toxicity_"))
    .map(row => ({ ...row, text: row.text.replace(/^Assessment records /, "Reported ")
      .replace(/ This does not establish a treatment cause\./g, "") }));
  const selectedPlan = guidance.carePlan.products.status === "selected"
    ? guidance.carePlan.products.plans.map(row => ({ id: `rule:product:${row.id}`,
      text: "The selected nutrition support plan guides supplementation." })) : [];
  const actionLines = [...nutritionContent, ...treatmentContent].flatMap(row => row.text.split(/\n/u)
    .map(text => ({ id: row.id, text: text.trim().replace(/^[•-]\s*/u, "") }))
    .filter(item => /^(?:if\b.{0,120}\b(?:contact|call|tell|discuss|check)|contact|call|tell|discuss|seek)\b/i.test(item.text)));
  const monitoringLines = [...nutritionContent, ...treatmentContent, ...conditionContent].flatMap(row => row.text.split(/\n/u)
    .map(text => ({ id: row.id, text: text.trim().replace(/^[•-]\s*/u, "") }))
    .filter(item => /^(?:monitor|track|check|record|keep track|watch)\b/i.test(item.text) && !/:\s*$/.test(item.text)));
  const action = actionLines[0];
  const monitoring = monitoringLines.filter(line => line.text !== action?.text).slice(0, 2);
  const nutritionStrategy = guidance.nutritionInterventions[0]?.coreStrategy.trim()
    ? [{ id: `rule:nutrition:${guidance.nutritionInterventions[0].id}`,
      text: `Nutrition priority: ${guidance.nutritionInterventions[0].coreStrategy.trim()}` }] : [];
  const overallRows = [...findingRows, ...nutritionStrategy, ...selectedPlan, ...(action ? [action] : []), ...monitoring.slice(0, 1)];
  // The closing summary uses explicit recorded facts and matched strategy. It
  // never treats conditional effects as observed symptoms.
  const summary = overallRows.length ? part(overallRows) : part([{
    id: "fact:niq_risk", text: `Nutrition support is guided by the reviewed ${classification.label} risk category.`,
  }]);
  const narrative: CompleteReportNarrative = {
    // Clinical facts already have their own cards; interpretation stays brief.
    overview: part([]),
    keyFindings: part([...findingRows, ...nutritionStrategy, ...reportedSymptoms]),
    actionSummary: part(action ? [action] : []),
    monitoringSummary: part(monitoring),
    overallSummary: summary,
    nutritionAdvice: part(nutritionContent),
    treatmentAdvice: part(treatmentContent),
    conditionAdvice: part(conditionContent),
    effectsAdvice: part(effectContent),
    foodSafetyAdvice: part(partitions.foodSafety),
    redFlagsAdvice: part(partitions.redFlags),
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
      : section && !narrative[section].evidenceIds.includes(row.id)
        && !narrative.redFlagsAdvice.evidenceIds.includes(row.id)
        && !narrative.foodSafetyAdvice.evidenceIds.includes(row.id))
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
