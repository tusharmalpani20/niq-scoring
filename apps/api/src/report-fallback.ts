import { closingReportSummary } from "./report-closing-summary";
import { narrativeSchema, type ReportContentRequest, type ReportEvidence, type ReportNarrative, type CompleteReportNarrative, matchedReportPacket } from "./report-content";
import { productExceptionActionText } from "@niq-scoring/contracts/product-guidance";
import { markFallbackHighlight, selectActionHighlight } from "./report-highlights";

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
}): { narrative: ReportNarrative; guidance: Omit<Packet, "possibleToxicities"> & { possibleToxicities: Array<Packet["possibleToxicities"][number] & { summary: string }> } } {
  const { facts, guidance, evidence } = input;
  const evidenceIds = new Set(evidence.map(item => item.id));
  const requireSource = (id: string, value: string) => {
    if (!evidenceIds.has(id) || !value.trim()) throw new ReportFallbackError("FALLBACK_SOURCE_INCOMPLETE");
    return value.trim();
  };
  const part = (rows: Array<{ id: string; text: string }>) => ({
    text: [...new Map(rows.filter(row => row.text.trim()).map(row => {
      const text = patientLanguage(row.text.trim());
      return [text.toLocaleLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, ""), text] as const;
    })).values()].join("\n"),
    evidenceIds: [...new Set(rows.filter(row => row.text.trim()).flatMap(row => row.id.split(" ")))],
  });
  function patientLanguage(text: string): string {
    return text.replace(/;\s*/g, ", ")
      .replace(/\bORS\b/g, "oral rehydration solution")
      .replace(/\bCBC\b/g, "complete blood count")
      .replace(/\bBP\b/g, "blood pressure")
      .replace(/\bONS\b/g, "oral nutrition supplement")
      .replace(/\bDM\b/g, "diabetes mellitus")
      .replace(/\bTSH\b/g, "thyroid-stimulating hormone")
      .replace(/\bLFTs?\b/g, "liver function tests")
      .replace(/\blow-GI\b/gi, "low glycemic index")
      .replace(/\bkcal\/kg\/day\b/gi, "kilocalories per kilogram of body weight per day")
      .replace(/\bg\/kg\/day\b/gi, "grams per kilogram of body weight per day")
      .replace(/\bL fluids\/day\b/gi, "liters of fluid per day")
      .replace(/\bL\/day\b/gi, "liters per day")
      .replace(/≥/g, "at least ").replace(/≤/g, "at most ");
  }

  // The model is the primary partitioner. This conservative sentence-level
  // fallback keeps safety clauses in the dedicated sections without losing
  // the original source evidence ID.
  const partition = (rows: Array<{ id: string; text: string }>) => {
    const advice: typeof rows = [], foodSafety: typeof rows = [], redFlags: typeof rows = [], monitoring: typeof rows = [];
    for (const row of rows) {
      let sourceSection: "advice" | "food" | "red" | "monitor" = "advice";
      const sentences = row.text.split(/\n|•\s*|(?<=[!?])\s+|(?<!\d)\.(?!\d)\s+/u).map(text => text.trim()).filter(Boolean);
      for (const text of sentences) {
        if (/^(?:red[- ]flag notes?|red flags?)\s*:?$/i.test(text)) { sourceSection = "red"; continue; }
        if (/^(?:monitor(?:ing)?(?: and escalation)?|follow[- ]?up)\s*:?$/i.test(text)) { sourceSection = "monitor"; continue; }
        if (/^(?:symptom[- ]wise management|food safety|food hygiene)\s*:?$/i.test(text)) {
          sourceSection = /food/i.test(text) ? "food" : "advice"; continue;
        }
        if (/^(?:energy and protein|nutrition(?:al)? advice|actions?)\s*:?$/i.test(text)) { sourceSection = "advice"; continue; }
        if (/^#{1,3}\s+\S/.test(text)) { advice.push({ id: row.id, text }); sourceSection = "advice"; continue; }
        if (sourceSection === "monitor" && /^(?:prevent|adapt|maintain|achieve|introduce|use|avoid|include|choose)\b/i.test(text)) sourceSection = "advice";
        const item = { id: row.id, text };
        const target = sourceSection === "red" || /\b(?:seek urgent(?: medical)? (?:care|help)|medical emergency|call (?:your )?(?:doctor|oncologist) immediately|contact (?:your )?(?:doctor|oncologist) immediately|(?:fever|chills).{0,100}immediately|\d+ or more stools.{0,100}immediately|(?:contact|call) (?:the |your )?(?:doctor|oncologist|care team) if|call if|call for|(?:blood pressure medicines|BP tablets) can cause very low (?:BP|blood pressure))\b/i.test(text)
          ? redFlags
          : sourceSection === "monitor" ? monitoring
          : sourceSection === "food" || /\b(?:food safety|freshly cooked|washed and peeled|washed\/peeled|boiled water|unpasteuri[sz]ed|raw sprouts|street food|leftovers?|food hygiene)\b/i.test(text) ? foodSafety
          : /\b(?:check|monitor|record|track|review)\b/i.test(text) && /\b(?:weight|blood pressure|CBC|cycle|visit|intake|reading|symptoms?)\b/i.test(text) ? monitoring
          : advice;
        target.push({ ...item, text: makeReadable(text, sourceSection) });
      }
    }
    return { advice, foodSafety, redFlags, monitoring };
  };

  function makeReadable(text: string, sourceSection: "advice" | "food" | "red" | "monitor"): string {
    let readable = text.replace(/^\s*[•-]\s*/u, "").replace(/\s+/g, " ").trim()
      .replace(/^Achieve energy:/i, "Daily energy target:")
      .replace(/^Achieve protein:/i, "Daily protein target:")
      .replace(/^Moderate risk[;,]\s*intake may drop with (.+)$/i, "Your intake may drop with $1")
      .replace(/^Maintain oral intake/i, "Aim to maintain oral intake")
      .replace(/^(?:Maintain|Aim to maintain) oral intake (?:≥|at least )?75%/i, "Aim to meet at least 75% of your nutrition needs through oral intake")
      .replace(/^Introduce ONS if intake is suboptimal/i, "Implement the prescribed nutrition support plan to meet nutritional requirements and support treatment tolerance")
      .replace(/^Energy (.+?) kcal\/kg\/day;\s*protein (.+?) g\/kg\/day/i,
        "Daily energy target: $1 kilocalories per kilogram of body weight per day, and protein target: $2 grams per kilogram of body weight per day")
      .replace(/^Sodium under 2 g\/day,?\s*/i, "Choose lower-sodium foods, ")
      .replace(/^Strict food safety \((.+)\)$/i, "For food safety, use $1")
      .replace(/\bDASH approach-?/i, "DASH-style eating: ")
      .replace(/\bBP tablets\b/gi, "blood pressure medicines")
      .replace(/\bBP\b/g, "blood pressure")
      .replace(/\bCKD\b/g, "chronic kidney disease")
      .replace(/\bGI\b/g, "glycemic index")
      .replace(/\bTSH\b/g, "thyroid-stimulating hormone")
      .replace(/\bLFT\b/g, "liver function test")
      .replace(/\s+–\s+/g, ", ").replace(/\s*&\s*/g, " and ");
    readable = readable.replace(/^For food safety, use freshly cooked food[;,]\s*washed\/peeled fruit[;,]\s*boiled or filtered water[;,]\s*no street food or leftovers older than 24 h\.?$/i,
      "For food safety, eat freshly cooked food, wash and peel fruit, use boiled or filtered water, and avoid street food or leftovers older than 24 hours.")
      .replace(/^Adequate protein and energy\.?$/i, "Maintain adequate protein and energy intake.")
      .replace(/^ORS and fluids to replace losses\.?$/i, "Replace fluid losses with oral rehydration solution and other fluids.")
      .replace(/^Low-residue soft foods/i, "Choose low-residue soft foods")
      .replace(/^Small frequent meals\.?$/i, "Eat small, frequent meals.")
      .replace(/^Small, frequent, bland, cool meals/i, "Eat small, frequent, bland, cool meals")
      .replace(/^Antiemetics on schedule\.?$/i, "Take your prescribed anti-nausea medicines on schedule.")
      .replace(/^Ginger in modest amounts\.?$/i, "Use ginger in modest amounts.")
      .replace(/^ORS sips if vomiting\.?$/i, "If vomiting occurs, take small sips of oral rehydration solution.")
      .replace(/^Soft, moist, lukewarm or cool foods/i, "Choose soft, moist, lukewarm or cool foods")
      .replace(/^Soft moist foods \((.+)\), mouth rinses, a fluid target\.?$/i, "Choose soft, moist foods ($1), rinse your mouth, and follow your fluid target.")
      .replace(/^Bland salt–soda rinse after meals\.?$/i, "Use a mild salt and baking soda rinse after meals.")
      .replace(/^Soft toothbrush\.?$/i, "Use a soft toothbrush.")
      .replace(/^Diarrhea plan ready at home: (.+)\.?$/i, "Keep a diarrhea plan ready at home with $1.")
      .replace(/^Call if (.+)$/i, "Contact your care team if $1")
      .replace(/^Call for gain over (\d+(?:\.\d+)?) kg in a day or breathlessness\.?$/i, "Contact your care team if you gain over $1 kg in a day or become breathless.")
      .replace(/^Prevent muscle loss and fatigue\.?$/i, "Take steps to prevent muscle loss and fatigue.")
      .replace(/^Adapt nutrition to treatment-related symptoms\.?$/i, "Adjust your nutrition to manage symptoms related to treatment.")
      .replace(/\(hyper\)/gi, "when the thyroid is overactive")
      .replace(/\(hypo\)/gi, "when the thyroid is underactive");
    if (/^MODERATE\s*\(At Risk\)/i.test(readable)) readable = readable.replace(/^MODERATE\s*\(At Risk\)\s*/i, "");
    if (sourceSection === "monitor") readable = readable.replace(/^Weight trends$/i, "Monitor weight trends")
      .replace(/^Intake decline$/i, "Monitor for a decline in food intake")
      .replace(/^Early symptoms$/i, "Watch for early symptoms");
    if (/^Check and record blood pressure/i.test(readable)) readable = readable.replace(/^Check and record blood pressure/, "Check and record your blood pressure");
    readable = readable.replace(/^Contact the doctor if:/i, "Contact your doctor if")
      .replace(/^Drugs and dehydration:\s*with (.+), blood pressure medicines can cause very low blood pressure\.?$/i,
        "Contact your doctor early if $1 occurs while you take blood pressure medicines. They can cause very low blood pressure.")
      .replace(/^Inform the doctor early, and the patient should not stop tablets alone\.?$/i, "Do not stop your blood pressure medicines on your own.");
    if (readable && !/[.!?]$/.test(readable) && !/^#{1,3}\s/.test(readable)) readable += ".";
    return readable;
  }

  function sanitizeCondition(conditionId: string, source: string): string {
    if (conditionId !== "co_morbidities_hypertension") return source;
    return source.split("\n").map(line => {
      if (/^•?\s*Sodium:/i.test(line))
        return "Keep sodium below 2 g per day (about 5 g of salt). If you are malnourished, keep sodium below 2.3 g per day, and do not let this restriction reduce your food intake.";
      if (/^•?\s*Diet:/i.test(line))
        return "Use a DASH-style eating pattern and include one fruit each day. Include potassium-rich foods only if your kidney guidance allows them. Avoid alcohol and smoking, and limit pickles, papad, chutneys, sauces, and packaged foods, which can be high in sodium.";
      return line;
    }).join("\n");
  }

  function groupReportedSymptoms(rows: ReportEvidence[]): Array<{ id: string; text: string }> {
    const mouth = rows.filter(row => /mouth sores?|mouth ulcers?|mucositis/i.test(row.text));
    const rest = rows.filter(row => !mouth.includes(row) && !/appetite|functional capacity/i.test(row.text));
    const result = rest.map(row => {
      const match = row.text.match(/^Assessment records ([^:]+):\s*(.*?)(?:\. This does not establish a treatment cause\.)?$/i);
      const text = match ? `You reported ${(match[2] ?? "").toLocaleLowerCase()}.`
          : patientLanguage(row.text.replace(/^Assessment records /, "Reported ").replace(/ This does not establish a treatment cause\./g, ""));
      return { ...row, text };
    });
    if (mouth.length) result.unshift({ id: mouth.map(row => row.id).join(" "),
      text: "Mouth sores were reported in this assessment." });
    return result;
  }

  function consolidateRedFlags(rows: Array<{ id: string; text: string }>): Array<{ id: string; text: string }> {
    const groups = {
      // Merge only matching urgent rules. Glucose, blood pressure, thyroid,
      // and other contact thresholds keep their source urgency and wording.
      fever: rows.filter(row => /\b(?:temperature|fever|chills)\b/i.test(row.text)),
      diarrhea: rows.filter(row => /\b\d+ or more (?:loose )?stools?\b|\bblood\b.*\b(?:diarrhea|stool)|\bdiarrhea\b.*\b(?:blood|fever)\b/i.test(row.text)),
      dizziness: rows.filter(row => /\bdizz(?:y|iness)\b/i.test(row.text) && /\b(?:diarrhea|loose stools?|\d+ or more stools?)\b/i.test(row.text)),
      intake: rows.filter(row => /\b(?:unable to eat or drink|unable to eat|unable to drink|white patches)\b/i.test(row.text)),
      dehydration: rows.filter(row => /\b(?:blood pressure medicines can cause very low blood pressure|contact your doctor early if .*blood pressure medicines)\b/i.test(row.text)),
      // A duration or count distinguishes the dedicated vomiting rule from
      // other contact rules that happen to mention vomiting.
      vomiting: rows.filter(row => /\b(?:more than \d+ (?:vomits|episodes of vomiting)|unable to keep fluids down for \d+\s*(?:hours?|h))\b/i.test(row.text)),
    };
    const consumed = new Set(Object.values(groups).flat());
    const result = rows.filter(row => !consumed.has(row));
    const add = (items: typeof rows, text: string) => { if (items.length) result.push({ id: items.map(item => item.id).join(" "), text }); };
    if (groups.fever.length) {
      const temperature = groups.fever.map(item => item.text.match(/(\d+(?:\.\d+)?)\s*°\s*F(?:\s*\((\d+(?:\.\d+)?)\s*°\s*C\))?/i)).find(Boolean);
      const trigger = temperature ? `a temperature of ${temperature[1]}°F${temperature[2] ? ` (${temperature[2]}°C)` : ""} or higher, chills, or feeling unwell` : "fever, chills, or feeling unwell";
      add(groups.fever, `Contact your oncologist immediately for ${trigger}.`);
    }
    if (groups.diarrhea.length) {
      const sources = groups.diarrhea.map(item => item.text).join(" ");
      const threshold = sources.match(/\b(\d+) or more (?:loose )?stools?(?: above (?:your )?(?:usual )?baseline)?\b/i)?.[1];
      const triggers = [threshold ? `${threshold} or more loose stools above your usual baseline` : "worsening diarrhea",
        /\bblood\b/i.test(sources) ? "blood in the stool" : "",
        /\bfever\b/i.test(sources) ? "diarrhea with fever" : ""].filter(Boolean);
      add(groups.diarrhea, `Contact your oncologist immediately for ${triggers.join(", or ")}.`);
    }
    const dizzinessOnly = groups.dizziness.filter(row => !/\b(?:oncologist|oncology) immediately\b/i.test(row.text));
    if (dizzinessOnly.length) add(dizzinessOnly, "Contact your care team if diarrhea occurs with dizziness.");
    if (groups.intake.length) add(groups.intake, "Contact your care team if you are unable to eat or drink, or notice white patches in your mouth.");
    if (groups.dehydration.length) add(groups.dehydration,
      "Contact your doctor early if diarrhea, vomiting, or poor fluid intake occurs while taking blood pressure medicines, as they can cause very low blood pressure.");
    if (groups.vomiting.length) {
      const sources = groups.vomiting.map(item => item.text).join(" ");
      const count = sources.match(/more than (\d+) (?:vomits|episodes of vomiting)\s*(?:\/|per)\s*day/i)?.[1];
      const duration = sources.match(/(?:unable to keep fluids down|cannot keep fluids down) for (\d+)\s*(hours?|h)\b/i)?.[1];
      const trigger = [count ? `more than ${count} episodes of vomiting in a day` : /vomit/i.test(sources) ? "vomiting" : "",
        duration ? `being unable to keep fluids down for ${duration} hours` : /keep fluids down/i.test(sources) ? "being unable to keep fluids down" : ""].filter(Boolean).join(" or ");
      add(groups.vomiting, `Contact your care team if ${trigger || "vomiting occurs"}.`);
    }
    const unique = new Map<string, { id: string; text: string }>();
    for (const row of result) {
      const key = row.text.toLocaleLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
      const previous = unique.get(key);
      unique.set(key, previous ? { id: `${previous.id} ${row.id}`, text: previous.text } : row);
    }
    return [...unique.values()];
  }

  function symptomTerms(text: string): string[] {
    const terms: string[] = [];
    if (/mouth|mucositis/i.test(text)) terms.push("mouth sores");
    if (/diarrh|loose stool/i.test(text)) terms.push("diarrhea");
    if (/nausea|vomit/i.test(text)) terms.push("nausea");
    return terms;
  }
  // A possible class-and-treatment effect is not a symptom reported by this
  // patient. Keep each matched intervention intact in its own conditional card.
  const possibleSafety = partition(guidance.possibleToxicities.map(row => ({
    id: `possible:toxicity:${row.id}`, text: row.nutritionalInterventions,
  })));
  const possibleToxicities = guidance.possibleToxicities.map(row => {
    const id = `possible:toxicity:${row.id}`;
    requireSource(id, row.nutritionalInterventions);
    if (!row.expectedToxicity.trim()) throw new ReportFallbackError("FALLBACK_SOURCE_INCOMPLETE");
    const intervention = [...possibleSafety.advice, ...possibleSafety.foodSafety, ...possibleSafety.redFlags, ...possibleSafety.monitoring]
      .filter(item => item.id === id).map(item => item.text).join(" ");
    const symptomMatches = evidence.some(item => item.id.startsWith("fact:assessment_")
      && symptomTerms(item.text).some(term => symptomTerms(row.expectedToxicity).includes(term)));
    // Shared sections do not replace the care needed to understand this card.
    const care = intervention || makeReadable(row.nutritionalInterventions, "advice");
    const summary = patientLanguage(symptomMatches ? care : `If this effect occurs, follow this guidance. ${care}`);
    // Prefer an action from the matched recommendation itself. The conditional
    // lead is only the fallback when the approved source has no action verb.
    const highlight = selectActionHighlight(intervention) ?? selectActionHighlight(summary);
    return { ...row, summary: highlight ? summary.replace(highlight, `**${highlight}**`) : summary };
  });

  const nutritionRows = guidance.nutritionInterventions.map(row => ({
    id: `rule:nutrition:${row.id}`,
    text: requireSource(`rule:nutrition:${row.id}`, `${row.coreStrategy}\n${row.clinicalActions}`),
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
    text: `### ${row.label}\n${requireSource(`rule:comorbidity:${row.id}`, sanitizeCondition(row.conditionId, row.guidance))}`
      .replace(/Energy and protein: use the targets for the patient's nutritional status\./i,
        "Use the energy and protein targets for your nutritional status.") }));
  const reportedEffectRows = guidance.toxicityInterventions.map(row => ({ id: `rule:toxicity:${row.id}`,
    text: `${facts.confirmedToxicityIds.includes(row.id) ? "Clinician-confirmed effect" : "Reported effect"}: ${row.expectedToxicity}. ${requireSource(`rule:toxicity:${row.id}`, row.nutritionalInterventions)}` }));
  const reportedCandidateRows = guidance.possibleToxicities.filter(row => evidence.some(item => item.id.startsWith("fact:assessment_")
    && symptomTerms(item.text).some(term => symptomTerms(row.expectedToxicity).includes(term))))
    .map(row => ({ id: `possible:toxicity:${row.id}`,
      text: possibleSafety.advice.filter(item => item.id === `possible:toxicity:${row.id}`).map(item => item.text).join(" ") }));
  const partitions = partition([...nutritionRows, ...treatmentRows, ...conditionRows, ...reportedEffectRows,
    ...guidance.possibleToxicities.map(row => ({ id: `possible:toxicity:${row.id}`, text: row.nutritionalInterventions }))]);
  const nutritionContent = partition(nutritionRows).advice;
  const treatmentContent = partition(treatmentRows).advice;
  const conditionContent = partition(conditionRows).advice.filter(row => !/choose a diabetes-appropriate supplement/i.test(row.text));
  const effectContent = partition([...reportedEffectRows, ...reportedCandidateRows]).advice;
  // Nutritional status is already shown by the report UI. Keep the status row
  // in the evidence ledger without repeating it in the prose cards.
  const reportedSymptoms = groupReportedSymptoms(evidence.filter(row => row.id.startsWith("fact:assessment_") || row.id.startsWith("fact:clinician_toxicity_")));
  const nutritionTargets = nutritionContent.flatMap(row => row.text.split(/\n/u).map(text => text.trim()));
  const nutritionHasEnergyAndProtein = nutritionTargets.some(text => /^Daily energy target:/i.test(text))
    && nutritionTargets.some(text => /^Daily protein target:/i.test(text));
  const deduplicatedTreatmentContent = treatmentContent.filter(row =>
    (!nutritionHasEnergyAndProtein || !/^Daily energy target:/i.test(row.text))
    && !(reportedCandidateRows.length && /^(?:Choose soft, moist foods|Your intake may drop with mouth sores)/i.test(row.text)));
  const conditionMonitoringText = new Set([...conditionContent, ...partitions.monitoring].flatMap(row => row.text.split(/\n/u)
    .map(text => text.trim().toLocaleLowerCase())
    .filter(text => /^(?:check|monitor|track|record|watch)\b/i.test(text))));
  const deduplicatedConditionContent: typeof conditionContent = [];
  let pendingConditionHeading: (typeof conditionContent)[number] | null = null;
  for (const row of conditionContent) {
    for (const text of row.text.split(/\n/u).map(value => value.trim()).filter(Boolean)) {
      const item = { ...row, text };
      if (/^#{1,3}\s+/.test(text)) { pendingConditionHeading = item; continue; }
      if (conditionMonitoringText.has(text.toLocaleLowerCase())) continue;
      if (pendingConditionHeading) { deduplicatedConditionContent.push(pendingConditionHeading); pendingConditionHeading = null; }
      deduplicatedConditionContent.push(item);
    }
  }
  const actionLines = [...nutritionContent, ...treatmentContent].flatMap(row => row.text.split(/\n/u)
    .map(text => ({ id: row.id, text: text.trim().replace(/^[•-]\s*/u, "") }))
    .filter(item => /^(?:if\b.{0,120}\b(?:contact|call|tell|discuss|check)|contact|call|tell|discuss|seek)\b/i.test(item.text)));
  const monitoringLines = [...nutritionContent, ...treatmentContent, ...conditionContent, ...partitions.monitoring].flatMap(row => row.text.split(/\n/u)
    .map(text => ({ id: row.id, text: text.trim().replace(/^[•-]\s*/u, "") }))
    .filter(item => /^(?:monitor|track|check|record|keep track|watch)\b/i.test(item.text)
      && /\b(?:weight|blood pressure|thyroid-stimulating hormone|thyroid|CBC|cycle|visit|intake|reading|symptoms?)\b/i.test(item.text)
      && !/:\s*$/.test(item.text)));
  const action = actionLines[0];
  const monitoring = monitoringLines.filter(line => line.text !== action?.text);
  const nutritionStrategy = guidance.nutritionInterventions[0]?.coreStrategy.trim()
    ? [{ id: `rule:nutrition:${guidance.nutritionInterventions[0].id}`,
      text: (() => {
        const strategy = guidance.nutritionInterventions[0].coreStrategy.trim().replace(/[.!?]+$/, "").replace(/^./, letter => letter.toLocaleLowerCase());
        return /^(?:maintain|prevent|optimise|optimize|support|improve|preserve|meet|avoid)\b/i.test(strategy)
          ? `Your nutrition plan aims to ${strategy}.` : `Your nutrition plan prioritises ${strategy}.`;
      })() }] : [];
  const summary = closingReportSummary({
    riskLabel: input.classification.label,
    evidence,
    nutrition: [...nutritionContent, ...treatmentContent, ...effectContent],
    monitoring,
    products: guidance.carePlan.products.status === "selected"
      ? guidance.carePlan.products.plans.map(row => ({ id: `rule:product:${row.id}`, text: row.products })) : [],
  });
  // Build complete sentences from pinned facts, rather than joining raw labels.
  // Qualify the effect on eating only when the matched guidance supports it.
  const sentence = (text: string) => /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
  const interpretationRows = [
    { id: "fact:niq_risk", text: `Your NIQ score of ${facts.reviewedScore} indicates ${input.classification.label.toLocaleLowerCase()}.` },
    ...evidence.filter(row => row.id === "fact:weight_direction").map(row => ({ ...row,
      text: sentence(row.text.replace(/^Recorded weight (gain|loss): ([\d.]+) kg previously and ([\d.]+) kg currently \(([\d.]+)%\)\. The previous measurement was recorded on ([\d-]+); the current measurement was recorded on ([\d-]+)\..*$/,
        "Your recorded weight changed from $2 kg on $5 to $3 kg on $6, a $4% $1.")
        .replace(/^Recorded weight no change: ([\d.]+) kg previously and ([\d.]+) kg currently \([\d.]+%\)\. The previous measurement was recorded on ([\d-]+); the current measurement was recorded on ([\d-]+)\..*$/,
          "Your recorded weight remained $2 kg between $3 and $4.")
        .replace(/^Recorded weight (gain|loss): ([\d.]+) kg previously and ([\d.]+) kg currently \(([\d.]+)%\)\. The previous weight was reported for 1 month ago\.$/,
        "Your weight has changed from $2 kg one month ago to $3 kg, a $4% $1.")
        .replace(/^Recorded weight no change: ([\d.]+) kg previously and ([\d.]+) kg currently \([\d.]+%\)\. The previous weight was reported for 1 month ago\.$/,
          "Your weight remains $2 kg compared with one month ago.")) })),
    ...evidence.filter(row => row.id === "fact:bmi").map(row => ({ ...row,
      text: sentence(row.text.replace(/^BMI:\s*/, "Your BMI is ")) })),
    ...evidence.filter(row => /^fact:assessment_appetite_status_/.test(row.id)).map(row => {
      const label = row.text.replace(/^Assessment records [^:]+:\s*/, "").replace(/\. This does not establish a treatment cause\.$/, "").replace(/\.$/, "");
      return { ...row, text: /^normal$/i.test(label) ? "You report a normal appetite." : `Your reported appetite is ${label.toLocaleLowerCase()}.` };
    }),
    ...evidence.filter(row => /^fact:assessment_functional_capacity_/.test(row.id)).map(row => {
      const label = row.text.replace(/^Assessment records [^:]+:\s*/, "").replace(/\. This does not establish a treatment cause\.$/, "").replace(/\.$/, "");
      return { ...row, text: /^reduced activity$/i.test(label) ? "Your functional activity is reduced." : `Your recorded functional capacity is ${label.toLocaleLowerCase()}.` };
    }),
    ...reportedSymptoms,
    ...nutritionStrategy,
  ];
  const mouthFact = evidence.find(row => row.id.startsWith("fact:assessment_") && /mouth sores?|mouth ulcers?|mucositis/i.test(row.text));
  const mouthEatingRule = nutritionRows.find(row => /mouth sores?|mouth ulcers?|mucositis/i.test(row.text) && /intake|eat|nutrition/i.test(row.text));
  if (mouthFact && mouthEatingRule) interpretationRows.push({ id: `${mouthFact.id} ${mouthEatingRule.id}`,
    text: "Mouth sores may make eating more difficult, so maintaining your nutritional intake is a priority." });
  const narrative: CompleteReportNarrative = {
    // Clinical facts already have their own cards; interpretation stays brief.
    overview: part([]),
    keyFindings: { ...part(interpretationRows), text: part(interpretationRows).text.replace(/\n+/g, " ") },
    actionSummary: part(action ? [action] : []),
    monitoringSummary: part(monitoring),
    overallSummary: summary,
    nutritionAdvice: part(nutritionContent),
    treatmentAdvice: part(deduplicatedTreatmentContent),
    conditionAdvice: part(deduplicatedConditionContent),
    effectsAdvice: part(effectContent),
    foodSafetyAdvice: part(partitions.foodSafety),
    redFlagsAdvice: part(consolidateRedFlags(partitions.redFlags)),
  };
  for (const field of Object.keys(narrative) as Array<keyof CompleteReportNarrative>)
    narrative[field].text = markFallbackHighlight(field, narrative[field].text);
  const sectionFor = (id: string): keyof ReportNarrative | "possible" | null => {
    if (id.startsWith("rule:nutrition:")) return "nutritionAdvice";
    if (["rule:class:", "rule:status:", "rule:treatment:", "rule:exception:"].some(prefix => id.startsWith(prefix))) return "treatmentAdvice";
    if (id.startsWith("rule:comorbidity:")) return "conditionAdvice";
    if (id.startsWith("rule:toxicity:")) return "effectsAdvice";
    // The selected product plan has its own structured UI card.
    if (id.startsWith("rule:product:")) return null;
    if (id.startsWith("possible:toxicity:")) return "possible";
    return null;
  };
  const possibleIds = new Set(possibleToxicities.map(row => `possible:toxicity:${row.id}`));
  for (const row of evidence) {
    const section = sectionFor(row.id);
    if (section === "possible" ? !possibleIds.has(row.id)
    : section && !Object.values(narrative).some(part => part.evidenceIds.includes(row.id)))
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
