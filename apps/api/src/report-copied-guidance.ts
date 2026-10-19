import { exactRepairAnchors } from "./report-output-scope";

export type CopiedGuidanceFinding = {
  evidenceId: string;
  sourceQuote: string;
  matchedText: string;
  anchors: string[];
};

type Token = { word: string; start: number; end: number };
function tokens(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({
    word: match[0].toLocaleLowerCase(), start: match.index!, end: match.index! + match[0].length,
  }));
}

/** Keep the existing copying thresholds, but identify the actual overlap for
 * targeted repair. Punctuation is ignored, including sentence boundaries: the
 * original exact sentences are supplied as repair anchors to preserve meaning. */
export function copiedGuidanceFindings(text: string, sources: Array<{id: string; text: string}>): CopiedGuidanceFinding[] {
  const passage = tokens(text);
  if (passage.length < 8) return [];
  const passageText = passage.map(token => token.word).join(" ");
  const anchors = exactRepairAnchors([text]);
  const findings: CopiedGuidanceFinding[] = [];
  for (const source of sources) {
    const sourceWords = tokens(source.text);
    const sourceText = sourceWords.map(token => token.word).join(" ");
    const ranges: Array<{start: number; end: number}> = [];
    if (sourceWords.length >= 8 && sourceWords.length <= passage.length + 2 && passageText.includes(sourceText)) {
      const offset = passageText.indexOf(sourceText);
      const start = passageText.slice(0, offset).split(" ").length - 1;
      ranges.push({ start, end: start + sourceWords.length });
    }
    for (let index = 0; index <= passage.length - 25; index++) {
      const span = passage.slice(index, index + 25).map(token => token.word).join(" ");
      if (sourceText.includes(span)) ranges.push({start: index, end: index + 25});
    }
    const merged: typeof ranges = [];
    for (const range of ranges.sort((left, right) => left.start - right.start)) {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({...range});
    }
    for (const range of merged) {
      const start = passage[range.start]!.start;
      const end = passage[Math.min(range.end, passage.length) - 1]!.end;
      const matchedText = text.slice(start, end);
      const normalized = passage.slice(range.start, range.end).map(token => token.word).join(" ");
      // A merged range can span multiple separate source occurrences. Retain a
      // concrete original excerpt for its first matching 25-word window then.
      const quoteWords = sourceText.includes(normalized) ? normalized : passage.slice(range.start, Math.min(range.start + 25, range.end)).map(token => token.word).join(" ");
      const quoteOffset = sourceText.indexOf(quoteWords);
      const sourceStart = sourceText.slice(0, quoteOffset).split(" ").length - 1;
      const quoteLength = quoteWords.split(" ").length;
      const sourceQuote = source.text.slice(sourceWords[sourceStart]!.start, sourceWords[Math.min(sourceStart + quoteLength, sourceWords.length) - 1]!.end);
      const overlapping = anchors.filter(anchor => {
        let offset = text.indexOf(anchor);
        while (offset >= 0) {
          if (offset < end && offset + anchor.length > start) return true;
          offset = text.indexOf(anchor, offset + 1);
        }
        return false;
      });
      findings.push({evidenceId: source.id, sourceQuote, matchedText, anchors: overlapping});
    }
  }
  return findings;
}
