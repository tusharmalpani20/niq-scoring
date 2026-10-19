import type { ReportEvidence } from "./report-content";

export const REPORT_CARD_PRECAUTION_POLICY = `Keep each effect card self-contained. Where matched sources require clinical approval of probiotic supplements, retain that precaution in infection/myelosuppression/neutropenia cards and cards positively recommending probiotics. Where a matched thyroid comorbidity source gives medication separation from protein/soy supplements, cards recommending oral nutrition, protein or soy supplements (including ONS) must repeat the source separation interval, conditional on taking thyroid medication. The timing precaution must cover the type positively recommended in that card, or supplements generally; a narrower protein-only precaution does not qualify oral nutrition or soy supplement advice. Normal protein foods do not create a supplement-timing requirement. Do not invent precautions, numbers or units absent from supplied sources. Equivalent wording is valid. Do not replace practical advice with a cross-reference.`;

const marker = "\nSupplemental matched guidance, ONLY its instructions relevant to this card's effect: ";
const supplementType = String.raw`(?:oral\s+(?:nutrition(?:al)?|nutrient)|protein|soy)`;
// Coordinated names share their final noun: "oral nutrition and protein
// supplements" names both types. Use the same scopes for advice and timing.
const supplement = new RegExp(String.raw`\b(?:ONS|${supplementType}(?:(?:\s+(?:and|or)\s+|\s*,\s*(?:(?:and|or)\s+)?)${supplementType})*\s+supplements?)\b`, "giu");
const probiotic = /\bprobiotics?(?:\s+supplements?)?\b/giu;
const instruction = /\b(?:(?:do not|don['’]t|never|not)\s+(?:use|take|add|include|try|choose|consider|provide|offer|start|recommend)|do not|don['’]t|never|avoid|exclude|without|not|use|take|add|include|try|choose|consider|provide|offer|start|recommend|such as|options?)\b/giu;
const negative = /^(?:(?:do not|don['’]t|never)\b|avoid\b|exclude\b|without\b|not\b)/iu;
const thyroidMedicine = /\bthyroid\s+(?:medication|medicine|tablets?|replacement)\b/iu;
const duration = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[ -]?(hours?|hrs?|minutes?|mins?)\b/iu;
const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function sentences(text: string): string[] {
  return text.replace(/\*\*/gu, "").split(/(?<=[.!?])\s+|\n/iu).map(row => row.trim()).filter(Boolean);
}

function recommendations(text: string, target: RegExp): string[] {
  return sentences(text).flatMap(sentence => Array.from(sentence.matchAll(target)).filter(match => {
    if (/^\s+(?:allergy|intolerance)\b/iu.test(sentence.slice(match.index! + match[0].length))) return false;
    const preceding = sentence.slice(0, match.index);
    const nearest = Array.from(preceding.matchAll(instruction)).at(-1);
    // A medication timing clause describes a precaution, not a request to
    // consume the supplement named after "keep" or "separate".
    const timing = Array.from(preceding.matchAll(/\b(?:keep|separat\w*|apart|between|gap)\b/giu)).at(-1);
    if (timing && (!nearest || timing.index! > nearest.index!)) return false;
    if (nearest) return !negative.test(nearest[0]);
    const after = sentence.slice(match.index! + match[0].length);
    return /^\s+(?:(?:may|can|should|could|must)\s+(?:be\s+)?|(?:is|are)\s+)(?:used|taken|added|included|provided|offered|started|recommended)\b/iu.test(after);
  }).map(match => match[0]));
}

function recommends(text: string, target: RegExp): boolean {
  return recommendations(text, target).length > 0;
}

type SupplementScope = "oral" | "protein" | "soy";
function supplementScopes(phrase: string): SupplementScope[] {
  const scopes: SupplementScope[] = [];
  if (/\b(?:ONS|oral\s+(?:nutrition(?:al)?|nutrient))\b/iu.test(phrase)) scopes.push("oral");
  if (/\bprotein\b/iu.test(phrase)) scopes.push("protein");
  if (/\bsoy\b/iu.test(phrase)) scopes.push("soy");
  return scopes;
}

function timingScopes(sentence: string): Set<SupplementScope> {
  const scopes = new Set<SupplementScope>();
  // Only the timing instruction can qualify a recommendation elsewhere in the
  // sentence. Merely naming ONS before a narrower timing clause is insufficient.
  const timingStart = /\b(?:keep|separat\w*|allow|leave)\b/iu.exec(sentence)?.index ?? 0;
  const timing = sentence.slice(timingStart);
  const explicit = Array.from(timing.matchAll(supplement));
  for (const match of explicit) for (const scope of supplementScopes(match[0])) scopes.add(scope);
  for (const match of timing.matchAll(/\bsupplements?\b/giu)) {
    if (explicit.some(item => item.index! <= match.index! && item.index! + item[0].length >= match.index! + match[0].length)) continue;
    const priorWord = timing.slice(0, match.index).match(/([\p{L}]+)\s*$/u)?.[1]?.toLowerCase();
    if (!priorWord || /^(?:all|these|any|your|the|from|and|between|it|keep)$/u.test(priorWord)) {
      scopes.add("oral"); scopes.add("protein"); scopes.add("soy");
    }
  }
  return scopes;
}

function passages(source: string): { base: string; all: string[] } {
  const boundary = source.indexOf(marker);
  if (boundary < 0) return { base: source, all: [source] };
  const base = source.slice(0, boundary);
  const all = [base];
  try {
    const rows: unknown = JSON.parse(source.slice(boundary + marker.length));
    if (Array.isArray(rows)) for (const row of rows) {
      if (row && typeof row === "object" && typeof row.text === "string") all.push(row.text);
    }
  } catch {
    // Independent auditing handles malformed source context, never escaped text.
  }
  return { base, all };
}

function minutes(text: string): number | undefined {
  const match = text.match(duration);
  if (!match) return;
  const amount = numberWords[match[1]!.toLowerCase()] ?? Number(match[1]);
  return amount * (/^(?:hour|hr)/iu.test(match[2]!) ? 60 : 1);
}

function hasApproval(text: string): boolean {
  return sentences(text).some(sentence => /\bprobiotics?(?:\s+supplements?)?\b/iu.test(sentence)
    && !/\b(?:no|not|never)\s+(?:[\p{L}\p{Pd}]+\s+){0,4}(?:approval|approve|permission|consent)\b|\b(?:approval|permission)\s+(?:is\s+)?not\s+(?:needed|required)\b/iu.test(sentence)
    && /\b(?:approv\w*|permission|consent|clearance)\b/iu.test(sentence)
    && /\b(?:clinical|clinician|doctor|oncolog\w*|care[\s\p{Pd}]+team|healthcare|medical)\b/iu.test(sentence));
}

/** Narrow, non-waivable checks derived from supplied matched source wording.
 * These supplement independent clinical review; they neither prescribe a new
 * interval nor infer medication use from a thyroid diagnosis. */
export function cardPrecautionIssues(text: string, cardSource: string, matchedEvidence: ReportEvidence[]): string[] {
  const sources = passages(cardSource);
  const issues: string[] = [];
  const approvalQuote = sources.all.flatMap(sentences).find(sentence => hasApproval(sentence)
    && /\b(?:requir\w*|only|before|after|must|need\w*)\b/iu.test(sentence));
  if (approvalQuote && (/\b(?:infection|myelosuppression|neutropenia)\b/iu.test(sources.base) || recommends(text, probiotic))
    && !hasApproval(text)) {
    issues.push(`SOURCE_CARD_PRECAUTION:probiotic approval: retain the source clinical approval precaution in this card. Source: ${approvalQuote}`);
  }
  const requiredScopes = [...new Set(recommendations(text, supplement).flatMap(supplementScopes))];
  if (!requiredScopes.length) return issues;
  for (const row of matchedEvidence.filter(row => row.id.startsWith("rule:comorbidity:") && thyroidMedicine.test(row.text))) {
    const sourceSentences = sentences(row.text);
    const intervalSentence = sourceSentences.find(sentence => /\b(?:protein|soy)\b/iu.test(sentence)
      && /\bsupplements?\b/iu.test(sentence) && /\b(?:separat\w*|apart|between|gap)\b/iu.test(sentence) && minutes(sentence) !== undefined);
    if (!intervalSentence) continue;
    const expected = minutes(intervalSentence);
    const applicableScopes = requiredScopes.filter(scope => scope === "oral" || supplementScopes(intervalSentence).includes(scope));
    const conditionalSource = sourceSentences.find(sentence => thyroidMedicine.test(sentence) && /\b(?:if|when)\b/iu.test(sentence));
    // Without an explicit source condition, leave the broader meaning to the
    // clinical auditor rather than manufacturing a medication assumption.
    if (!conditionalSource) continue;
    const coveredScopes = new Set<SupplementScope>();
    sentences(text).forEach((sentence, index, all) => {
      if (minutes(sentence) !== expected || !/\b(?:supplements?|ONS)\b/iu.test(sentence)
        || !/\b(?:separat\w*|apart|between|gap)\b/iu.test(sentence)) return;
      const context = `${all[index - 1] ?? ""} ${sentence}`;
      const conditional = thyroidMedicine.test(context) && /\b(?:if|when)\s+(?:(?:you|the patient)\s+)?(?:(?:are|is)\s+)?(?:tak(?:e|es|ing)|us(?:e|es|ing)|prescribed)\s+thyroid\s+(?:medication|medicine|tablets?|replacement)\b|\b(?:if|when)\s+thyroid\s+(?:medication|medicine|tablets?|replacement)\s+(?:is|are)\s+(?:being\s+)?(?:taken|used|prescribed)\b/iu.test(context);
      if (conditional) for (const scope of timingScopes(sentence)) coveredScopes.add(scope);
    });
    if (applicableScopes.some(scope => !coveredScopes.has(scope))) issues.push(`SOURCE_CARD_PRECAUTION:thyroid supplement timing: repeat the source interval, conditional on taking thyroid medication, for every positively recommended supplement type (including oral nutrition supplements when recommended). A narrower supplement type does not qualify the other advice. Source (${row.id}): ${conditionalSource} ${intervalSentence}`);
  }
  return [...new Set(issues)];
}
