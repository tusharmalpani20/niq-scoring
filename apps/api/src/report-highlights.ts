import { z } from "zod";
import { narrativeFieldNames, type ReportNarrative } from "./report-content";

const phraseSchema = z.array(z.string().min(1).max(180)).max(3);
export const highlightSchema = z.object(Object.fromEntries(narrativeFieldNames.map(field => [field, phraseSchema])) as Record<(typeof narrativeFieldNames)[number], typeof phraseSchema>).strict();
export const highlightJsonSchema = {
  type: "object", additionalProperties: false, required: narrativeFieldNames,
  properties: Object.fromEntries(narrativeFieldNames.map(field => [field, { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } }])),
};

export function plainNarrative(narrative: ReportNarrative): ReportNarrative {
  return Object.fromEntries(narrativeFieldNames.map(field => [field, {
    ...narrative[field], text: narrative[field].text.replaceAll("**", ""),
  }])) as ReportNarrative;
}

/** The model may only choose exact, unique phrases in already reviewed prose. */
export function applyNarrativeHighlights(narrative: ReportNarrative, proposed: unknown): ReportNarrative | null {
  const parsed = highlightSchema.safeParse(proposed);
  if (!parsed.success) return null;
  const result = plainNarrative(narrative);
  for (const field of narrativeFieldNames) {
    const text = result[field].text;
    const phrases = parsed.data[field];
    if (Boolean(text.trim()) !== Boolean(phrases.length)) return null;
    const ranges: Array<{ start: number; end: number }> = [];
    for (const phrase of phrases) {
      const start = text.indexOf(phrase);
      const end = start + phrase.length;
      const words = phrase.match(/[\p{L}]+(?:[’'-][\p{L}]+)*/gu) ?? [];
      if (start < 0 || text.indexOf(phrase, end) !== -1 || words.length < 3 || words.length > 15
        || !/[\p{L}]/u.test(phrase) || /^[\s\p{P}\p{S}]/u.test(phrase) || /[\s\p{P}\p{S}]$/u.test(phrase)
        || start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1]!)
        || end < text.length && /[\p{L}\p{N}]/u.test(text[end]!)
        || ranges.some(range => start < range.end && end > range.start)) return null;
      ranges.push({ start, end });
    }
    let marked = text;
    for (const { start, end } of ranges.sort((a, b) => b.start - a.start))
      marked = `${marked.slice(0, start)}**${marked.slice(start, end)}**${marked.slice(end)}`;
    result[field] = { ...result[field], text: marked };
  }
  return result;
}
