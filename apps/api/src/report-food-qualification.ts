const dairy = /\b(?:curds?|yoghurts?|yogurts?)\b/iu;
const pasteurised = /\bpasteuri[sz]ed\b/iu;
const tolerated = /\b(?:if|when|as)\s+(?:(?:both\s+)?pasteuri[sz]ed\s+and\s+)?(?:(?:well|comfortably)\s+)?tolerated\b|\bif\s+(?:you|the patient)\s+(?:can\s+)?tolerate\s+(?:it|them)\b/iu;
const instruction = /\b(?:(?:do not|don['’]t|never)\s+(?:eat|have|try|include|choose)|avoid|exclude|excluding|without|except|free of|not(?!\s+only\b)|include|choose|try|eat|have)\b/giu;
const negative = /^(?:(?:do not|don['’]t|never)\b|avoid\b|exclude\b|excluding\b|without\b|except\b|free of\b|not\b)/iu;

function clauses(text: string): string[] {
  return text.replace(/\*\*/gu, "").split(/(?<=[.!?])\s+|\n|\b(?:but|however)\b/iu).map(part => part.trim()).filter(Boolean);
}

function recommendsDairy(text: string): boolean {
  return Array.from(text.matchAll(new RegExp(dairy.source, "giu"))).some(match => {
    const nearest = Array.from(text.slice(0, match.index).matchAll(instruction)).at(-1)?.[0];
    return !nearest || !negative.test(nearest);
  });
}

function sourcePassages(source: string): string[] {
  const marker = "\nSupplemental matched guidance, ONLY its instructions relevant to this card's effect: ";
  const boundary = source.indexOf(marker);
  if (boundary < 0) return [source];
  const passages = [source.slice(0, boundary)];
  try {
    const supplemental: unknown = JSON.parse(source.slice(boundary + marker.length));
    if (Array.isArray(supplemental)) {
      for (const row of supplemental) {
        if (row && typeof row === "object" && typeof row.text === "string") passages.push(row.text);
      }
    }
  } catch {
    // Malformed supplementary data stays with the independent source auditor;
    // do not manufacture requirements from escaped JSON fragments.
  }
  return passages;
}

/** Preserve explicit dairy qualifications supplied by the matched source. This
 * narrow guard does not create a dietary rule: without a positive source clause
 * requiring pasteurisation/tolerance, the corresponding condition is absent.
 * Other foods and clinical conditions remain under independent source review. */
export function foodQualificationIssues(text: string, source: string): string[] {
  const requirements = sourcePassages(source).flatMap(clauses).filter(recommendsDairy).flatMap(quote => {
    const conditions = [pasteurised.test(quote) ? "pasteurised" : null,
      tolerated.test(quote) ? "if tolerated" : null].filter((value): value is string => Boolean(value));
    return conditions.length ? [{ quote, conditions }] : [];
  });
  if (!requirements.length) return [];
  const issues = new Set<string>();
  for (const clause of clauses(text).filter(recommendsDairy)) {
    const missing = requirements.flatMap(requirement => requirement.conditions.filter(condition =>
      condition === "pasteurised" ? !pasteurised.test(clause) : !tolerated.test(clause)));
    if (missing.length) {
      const quotes = requirements.filter(requirement => requirement.conditions.some(condition => missing.includes(condition)))
        .map(requirement => requirement.quote);
      issues.add(`SOURCE_FOOD_QUALIFICATION:curd/yoghurt: retain ${[...new Set(missing)].join(" and ")} in this card's positive dairy advice. Source: ${[...new Set(quotes)].join(" ")}`);
    }
  }
  return [...issues];
}
