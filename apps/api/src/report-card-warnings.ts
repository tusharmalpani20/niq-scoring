/** Only explicit source assessment instructions link a condition to a card. A
 * broad supplemental warning list must not import unrelated effects. */
export const REPORT_CARD_WARNING_POLICY = `When an effect's base source explicitly asks the care team to check for or assess a named condition, and supplemental matched guidance gives that same condition a warning/contact action, retain that conditional action in the effect card itself. Routine assessment alone does not cover a source warning's urgency. Preserve the matched condition, timing, urgency, actor and additional actions; do not import unrelated conditions from the same supplemental warning list. Keep the warning conditional and do not imply the condition is present. Shared red flags cannot substitute for the applicable local card warning. Never invent warnings or thresholds absent from the sources.`;

const marker = "\nSupplemental matched guidance, ONLY its instructions relevant to this card's effect: ";
const normalise = (text: string) => text.toLowerCase().replace(/\*\*/gu, "").replace(/[’']/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const sentences = (text: string) => text.replace(/\*\*/gu, "").split(/(?<=[.!?])\s+|[\n•]/u).map(row => row.trim()).filter(Boolean);
const listItems = (text: string) => text.split(/,|\s+(?:and|or)\s+/iu).map(normalise).filter(Boolean);

function sourceParts(source: string): { base: string; supplemental: string[] } {
  const boundary = source.indexOf(marker);
  if (boundary < 0) return { base: source, supplemental: [] };
  const base = source.slice(0, boundary);
  try {
    const rows: unknown = JSON.parse(source.slice(boundary + marker.length));
    if (Array.isArray(rows)) return { base, supplemental: rows.flatMap(row => row && typeof row === "object" && typeof row.text === "string" ? [row.text] : []) };
  } catch { /* Malformed supplemental context does not establish an obligation. */ }
  return { base, supplemental: [] };
}

// Match only explicit assessment lists and colon-style warning instructions.
// Unstructured clinical implications remain the independent reviewer's job.
function assessedConditions(base: string): string[] {
  return Array.from(base.matchAll(/\b(?:check for|assess for|evaluate for)\s+([^;\n.!?]+)/giu))
    .flatMap(match => listItems(match[1]!));
}

function actionCovered(text: string, action: string): boolean {
  let candidate = normalise(text);
  let required = normalise(action);
  const equivalentGroups = [
    [/\b(?:prompt|promptly)\b/gu, "prompt"],
    [/\b(?:immediate|immediately)\b/gu, "immediate"],
    [/\b(?:urgent|urgently)\b/gu, "urgent"],
    [/\b(?:assessment|assess|evaluation|evaluate)\b/gu, "assessment"],
    [/\b(?:contact|call)\b/gu, "contact"],
  ] as const;
  for (const [pattern, canonical] of equivalentGroups) {
    candidate = candidate.replace(pattern, canonical);
    required = required.replace(pattern, canonical);
  }
  // An explicitly named source actor must survive. Clinical actors can stand
  // for generic "medical assessment", but generic clinicians cannot stand for
  // an explicitly required oncologist or oncology team.
  if (/\bmedical\b/u.test(required)) {
    candidate = candidate.replace(/\b(?:doctor|clinician|oncologist|oncology team|care team)\b/gu, "medical");
  }
  // Clinical action words, numbers and timing remain source-derived. Discard
  // only grammar, allowing "your doctor should assess" for "medical assessment".
  const grammar = new Set(["a", "an", "the", "your", "you", "to", "of", "and", "its", "their", "it", "is", "are", "should", "must", "seek", "get", "obtain", "arrange"]);
  const available = new Set(candidate.split(" "));
  return required.split(" ").filter(word => !grammar.has(word)).every(word => available.has(word));
}

export function cardWarningIssues(text: string, cardSource: string): string[] {
  const { base, supplemental } = sourceParts(cardSource);
  const conditions = new Set(assessedConditions(base));
  if (!conditions.size) return [];
  const issues: string[] = [];
  for (const quote of supplemental.flatMap(sentences)) {
    const colon = quote.indexOf(":");
    if (colon < 0) continue;
    const triggers = listItems(quote.slice(0, colon));
    const action = quote.slice(colon + 1).trim();
    if (!/\b(?:assessment|assess|evaluation|evaluate|contact|call|seek|emergency)\b/iu.test(action)) continue;
    for (const condition of triggers.filter(trigger => conditions.has(trigger))) {
      const covered = sentences(text).some(sentence => {
        const normalized = normalise(sentence);
        return ` ${normalized} `.includes(` ${condition} `)
          && /\b(?:if|when|for)\b/iu.test(sentence)
          && !/\b(?:do not|dont|not needed|no(?: \w+){0,5} (?:needed|required)|no need|never|without)\b/iu.test(normalized)
          && actionCovered(sentence, action);
      });
      if (!covered) issues.push(`SOURCE_CARD_WARNING: condition "${condition}": retain the source warning as a conditional instruction in this card, including its action, urgency, actor and timing. Routine assessment or a shared red flag does not substitute. Source: ${quote}`);
    }
  }
  return [...new Set(issues)];
}
