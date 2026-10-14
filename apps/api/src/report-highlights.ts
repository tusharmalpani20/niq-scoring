import { z } from "zod";
import { narrativeFieldNames, type ReportNarrative, type CompleteReportNarrative } from "./report-content";

const selectionSchema = z.object({
  phrase: z.string().min(1).max(180),
  kind: z.enum(["finding", "action", "warning"]),
}).strict();
const selectionsSchema = z.array(selectionSchema).max(3);
export const highlightSchema = z.object(Object.fromEntries(narrativeFieldNames.map(field => [field, selectionsSchema])) as Record<(typeof narrativeFieldNames)[number], typeof selectionsSchema>).strict();
export type HighlightSelections = z.infer<typeof highlightSchema>;

export function highlightJsonSchema(fields: readonly string[] = narrativeFieldNames) {
  return {
    type: "object", additionalProperties: false, required: fields,
    properties: Object.fromEntries(fields.map(field => [field, {
      type: "array", maxItems: 3, items: { type: "object", additionalProperties: false,
        required: ["phrase", "kind"], properties: { phrase: { type: "string", maxLength: 180 }, kind: { type: "string", enum: ["finding", "action", "warning"] } } },
    }])),
  };
}

export function plainNarrative(narrative: ReportNarrative): CompleteReportNarrative {
  return Object.fromEntries(narrativeFieldNames.map(field => [field, {
    ...(narrative[field] ?? { text: "", evidenceIds: [] }), text: (narrative[field]?.text ?? "").replaceAll("**", ""),
  }])) as CompleteReportNarrative;
}

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const actionVerb = /\b(?:aim|ask|avoid|call|check|choose|contact|discuss|follow|keep|maintain|monitor|record|report|seek|separate|share|take|tell|track|use)\b/i;
const interpretationCue = /\b(?:affect|change|changed|changes|concern|decline|decrease|decreased|help|important|increase|increased|maintain|monitor|prevent|priorities|priority|review|support|worsen|worsening)\b/i;
const numericMeaningCue = /\b(?:affect|concern|decline|help|important|maintain|monitor|prevent|priorities|priority|review|support|worsen|worsening)\b/i;

/** Pick a short, exact action phrase for deterministic fallback cards. */
export function selectActionHighlight(text: string): string | null {
  const sentences = Array.from(sentenceSegmenter.segment(text), item => item.segment);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    const conditionalAction = trimmed.match(/^(If\b.{0,80}?,\s*(?:follow|use|contact|call|discuss|check|tell|seek)\b[^,:.!?]*)(?=[:,.!?]|$)/i);
    if (conditionalAction && (conditionalAction[1]!.match(/[\p{L}]+(?:[’'-][\p{L}]+)*/gu) ?? []).length >= 3)
      return conditionalAction[1]!.trim();
    const words = Array.from(trimmed.matchAll(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu));
    const actionIndex = words.findIndex(word => actionVerb.test(word[0]));
    if (actionIndex < 0) continue;
    const startIndex = /^if\b/i.test(trimmed) ? 0 : actionIndex;
    const endIndex = Math.min(words.length, startIndex + 15);
    if (endIndex - startIndex < 3) continue;
    const start = words[startIndex]!.index!;
    const last = words[endIndex - 1]!;
    let end = last.index! + last[0].length;
    const clauseBreaks = Array.from(trimmed.slice(start, end).matchAll(/[,;:]/gu));
    const clauseEnd = clauseBreaks.at(-1)?.index;
    if (words.length - startIndex > 15 && clauseEnd !== undefined && clauseEnd > 0
      && (trimmed.slice(start, start + clauseEnd).match(/[\p{L}]+(?:[’'-][\p{L}]+)*/gu) ?? []).length >= 3)
      end = start + clauseEnd;
    const openingParenthesis = trimmed.indexOf("(", start);
    const closingParenthesis = trimmed.indexOf(")", openingParenthesis + 1);
    if (openingParenthesis >= start && openingParenthesis < end && (closingParenthesis < 0 || closingParenthesis >= end)) {
      const beforeExamples = trimmed.slice(start, openingParenthesis).trimEnd();
      if ((beforeExamples.match(/[\p{L}]+(?:[’'-][\p{L}]+)*/gu) ?? []).length >= 3) end = start + beforeExamples.length;
    }
    // Keep slash units such as mg/dL together when the word limit lands on
    // the first half of the measurement.
    const unitSuffix = trimmed.slice(end).match(/^\/(?:dL|mL|kg|day)\b/i)?.[0];
    if (unitSuffix) end += unitSuffix.length;
    const phrase = trimmed.slice(start, end).replace(/[,:;]+$/u, "").trim();
    if ((phrase.match(/[\p{L}]+(?:[’'-][\p{L}]+)*/gu) ?? []).length >= 3 && actionVerb.test(phrase)) return phrase;
  }
  return null;
}

/** Mark one exact action or priority phrase in deterministic fallback prose. */
export function markFallbackHighlight(field: (typeof narrativeFieldNames)[number], text: string): string {
  const phrase = selectActionHighlight(text) ?? (field === "overallSummary" || field === "keyFindings"
    ? Array.from(sentenceSegmenter.segment(text), item => item.segment.trim()).map(sentence => {
      const words = Array.from(sentence.matchAll(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu));
      if (!interpretationCue.test(sentence) || words.length < 3) return null;
      const end = Math.min(words.length, 15);
      return sentence.slice(words[0]!.index!, words[end - 1]!.index! + words[end - 1]![0].length);
    }).find(Boolean) ?? null : null);
  return phrase ? text.replace(phrase, `**${phrase}**`) : text;
}

function requiredHighlights(field: (typeof narrativeFieldNames)[number], text: string): number {
  if (!text.trim()) return 0;
  // Interpretation is rendered from overview and keyFindings together.
  // A factual overview needs no forced bold when keyFindings carries the takeaway.
  if (field === "overview" || field === "keyFindings") return 0;
  if (field === "conditionAdvice" && text.length > 500) return 3;
  if ((field === "treatmentAdvice" || field === "effectsAdvice" || field === "overallSummary") && text.length > 400) return 2;
  return 1;
}

/** The model supplies only selections; this checks exact spans and editorial coverage. */
export function assessNarrativeHighlights(narrative: ReportNarrative | CompleteReportNarrative, proposed: unknown) {
  const plain = plainNarrative(narrative);
  const parsed = highlightSchema.safeParse(proposed);
  const selected = parsed.success ? parsed.data : null;
  const marked = structuredClone(plain);
  const issues: Partial<Record<(typeof narrativeFieldNames)[number], string[]>> = {};
  const valid = {} as HighlightSelections;

  for (const field of narrativeFieldNames) {
    const text = plain[field].text;
    const choices = selected?.[field] ?? [];
    const fieldIssues: string[] = [];
    const ranges: Array<{ start: number; end: number }> = [];
    const accepted: typeof choices = [];
    const sentences = Array.from(sentenceSegmenter.segment(text), item => ({ start: item.index, end: item.index + item.segment.length }));
    for (const choice of choices) {
      const { phrase, kind } = choice;
      const start = text.indexOf(phrase);
      const end = start + phrase.length;
      const words = phrase.match(/[\p{L}]+(?:[’'-][\p{L}]+)*/gu) ?? [];
      const sameSentence = sentences.some(sentence => start >= sentence.start && end <= sentence.end);
      const interpretationField = field === "overview" || field === "keyFindings" || field === "overallSummary";
      const validPhrase = start >= 0 && text.indexOf(phrase, end) === -1
        && words.length >= 3 && words.length <= 15 && sameSentence
        && !/^[\s\p{P}\p{S}]/u.test(phrase) && !/[\s\p{P}\p{S}]$/u.test(phrase)
        && !(start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1]!))
        && !(end < text.length && /[\p{L}\p{N}]/u.test(text[end]!))
        && !ranges.some(range => start < range.end && end > range.start)
        && (!interpretationField || kind !== "finding" || interpretationCue.test(phrase))
        && (!interpretationField || kind !== "finding" || !/\d/.test(phrase) || numericMeaningCue.test(phrase))
        && (kind === "finding" || actionVerb.test(phrase))
        && (!/^if\b/i.test(phrase) || actionVerb.test(phrase));
      if (!validPhrase) { fieldIssues.push("INVALID_SPAN_OR_ACTION"); continue; }
      accepted.push(choice);
      ranges.push({ start, end });
    }
    if (accepted.length < requiredHighlights(field, text)) fieldIssues.push("INSUFFICIENT_COVERAGE");
    if (["nutritionAdvice", "treatmentAdvice", "conditionAdvice", "effectsAdvice", "actionSummary", "monitoringSummary"].includes(field)
      && actionVerb.test(text) && !accepted.some(choice => choice.kind === "action" || choice.kind === "warning"))
      fieldIssues.push("NO_ACTION_HIGHLIGHT");
    valid[field] = accepted;
    let result = text;
    for (const { start, end } of ranges.sort((a, b) => b.start - a.start))
      result = `${result.slice(0, start)}**${result.slice(start, end)}**${result.slice(end)}`;
    marked[field] = { ...marked[field], text: result };
    if (fieldIssues.length) issues[field] = fieldIssues;
  }
  if ((plain.overview.text.trim() || plain.keyFindings.text.trim())
    && valid.overview.length + valid.keyFindings.length === 0) {
    const field = interpretationCue.test(plain.keyFindings.text) ? "keyFindings" : "overview";
    issues[field] = [...(issues[field] ?? []), "INTERPRETATION_COVERAGE"];
  }
  return { marked, valid, issues, accepted: Object.keys(issues).length === 0 };
}

/** After model repair fails, use only short, complete sentences that pass the same checks. */
export function completeNarrativeHighlights(narrative: ReportNarrative | CompleteReportNarrative, current: HighlightSelections) {
  const plain = plainNarrative(narrative);
  const selected = structuredClone(current);
  let assessment = assessNarrativeHighlights(plain, selected);
  for (const field of narrativeFieldNames) {
    if (!assessment.issues[field]) continue;
    const sentences = Array.from(sentenceSegmenter.segment(plain[field].text), item => item.segment.trim());
    for (const sentence of sentences) {
      const phrase = selectActionHighlight(sentence) ?? sentence.replace(/[.!?]+$/u, "").trim();
      if (!phrase || selected[field].length === 3 || selected[field].some(choice => choice.phrase === phrase)) continue;
      const kind = /\b(?:contact|call|seek|urgent)\b/i.test(phrase) ? "warning" : actionVerb.test(phrase) ? "action" : "finding";
      const trial = { ...selected, [field]: [...selected[field], { phrase, kind }] } as HighlightSelections;
      const checked = assessNarrativeHighlights(plain, trial);
      if (checked.valid[field].length !== selected[field].length + 1) continue;
      selected[field] = trial[field];
      assessment = checked;
      if (!assessment.issues[field]) break;
    }
  }
  return assessment;
}
