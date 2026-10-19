export const PRESCRIBED_PLAN_SENTENCE = "Implement the prescribed nutrition support plan to meet nutritional requirements and support treatment tolerance.";
export const REPORT_EDITORIAL_POLICY = `Use direct patient-facing instructions throughout the report. Keep internal phrases such as matched guidance, matched rule, mapped classification, source checklist and reviewer approval out of every patient passage. Name the clinical action and retain its exact conditions, thresholds, urgency and responsible actor. Prefer concise wording and consolidate overlapping advice when writing or already repairing a passage, preserving every distinct supported detail. Harmless repetition of a supported recommendation is acceptable within a passage, across sections, and in summaries. Repetition alone, including identical sentences or a repeated prescribed-plan instruction, is an editorial preference, not an issuing blocker: do not reject, request another repair, or mark source coverage incomplete solely to remove it. If repeated wording creates a concrete clinical contradiction, ambiguity about quantity/frequency, unsupported instruction or confusing responsibility, flag that specific defect and its evidence instead. Keep complete supported care and applicable precautions in each separate possible-effect card. For source-supported laboratory or deficiency assessments and changes to nutrition support, explicitly name the care team as responsible or ask the care team to act, preserving the source conditions. Patient self-monitoring of weight, intake, symptoms and home readings may remain patient-directed. Audit every clinical-action clause in this pass, in every narrative field and each card, rather than leaving actor checks to final review. Do not add tests or treatment changes that the source does not support. Write complete sentences with capitalized openings, including after edits. Paraphrase source fragments as direct patient actions. Do not copy a multi-clause source list verbatim: regroup illustrative examples naturally, but preserve every distinct strategy, required combination, quantity, timing and qualification. Exact clinical numbers, units and necessary clinical terms need not be paraphrased. When relocating advice during a repair, resolve known copied wording in that same edit while preserving its meaning. Optional actionSummary may be empty; do not invent a next step just to fill it.`;
export type EditorialFinding = {field: string; code: string; text: string; reason: string};
const segmenter = new Intl.Segmenter("en",{granularity:"sentence"});
/** Only ordinary instruction openings are case-normalized. Medical notation,
 * units and text following common abbreviations keep their original case. */
export function normalizeReportSentenceStarts(text: string): string {
  return text.replace(/(^|[.!?]\s+|\n+)(["'“‘(]*)(you|your|ask|if|the|monitor|contact|check|keep|choose|use|take|avoid|include|follow|seek|inform)\b/gu,
    (match, boundary: string, quote: string, word: string, offset: number) => {
      if (boundary.startsWith(".") && /\b(?:e\.g|i\.e|dr|mr|mrs|ms|vs|etc)\.$/iu.test(text.slice(0, offset + 1))) return match;
      return boundary + quote + word[0]!.toLocaleUpperCase() + word.slice(1);
    });
}
const internal = /\b(?:reviewed NIQ score|mapped to|classification mapping|source checklist|rule engine|retained issue|reviewer approval|(?:the\s+)?sources\s+(?:also\s+)?(?:give|specify|state|say)|(?:the\s+)?(?:(?:status|rule|source)\s+)?guidance\s+(?:also\s+)?(?:advises|says|specifies)|these thresholds differ|matched\s+(?:[\p{L}\p{N} /-]+\s+)?(?:guidance|rules?|sources?))\b/iu;

/** Internal workflow terminology blocks patient-facing output; harmless
 * repetition is a writing preference, not a deterministic rejection. */
export function reportEditorialFindings(draft: Partial<Record<string,{text:string}>>): EditorialFinding[] {
  const findings: EditorialFinding[]=[];
  for(const [field,part] of Object.entries(draft)) {
    if(typeof part?.text!=="string"||!part.text)continue;
    const text=part.text.replaceAll("**","");
    const sentences=[...segmenter.segment(text)].map(x=>x.segment.trim()).filter(Boolean);
    for(const sentence of sentences)if(internal.test(sentence))findings.push({field,code:"INTERNAL_WORKFLOW_WORDING",text:sentence,
      reason:"Replace internal rule or review terminology with the direct patient instruction. Preserve every clinical condition, number, urgency and actor."});
  }
  return findings;
}
