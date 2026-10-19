/** Shared reference data must not widen a stage's response contract. */
export function constrainCoverageOutput(user: string, schema: Record<string, unknown>): Record<string, unknown> {
  const shape = schema as any;
  if (!shape.properties?.rows?.items?.properties?.evidenceId) return schema;
  const source = user.match(/(?:Candidate source rows|Source rows): ([^\n]*)/)?.[1];
  if (!source) return schema;
  let rows: Array<{ id?: string; evidenceId?: string }>;
  try { rows = JSON.parse(source); } catch { return schema; }
  if (!Array.isArray(rows)) return schema;
  const ids = rows.map(row => row.id ?? row.evidenceId);
  if (!ids.length || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) return schema;
  const constrained = structuredClone(schema) as any;
  constrained.properties.rows.minItems = ids.length;
  constrained.properties.rows.maxItems = ids.length;
  constrained.properties.rows.items.properties.evidenceId.enum = ids;
  return constrained;
}

/** Supply exact, unambiguous anchors. Repeated sentences need neighboring
 * original context so the model can address one occurrence without retyping. */
export function exactRepairAnchors(texts: string[]): string[] {
  const anchors = new Set<string>();
  const segmenter = new Intl.Segmenter("en", {granularity: "sentence"});
  const unique = (candidate: string) => texts.every(text => {
    const index = text.indexOf(candidate);
    return index < 0 || text.indexOf(candidate, index + 1) < 0;
  });
  for (const text of texts) {
    const units: Array<{start: number; end: number}> = [];
    let lineOffset = 0;
    for (const line of text.split("\n")) {
      for (const {segment, index} of segmenter.segment(line)) {
        const sentence = segment.trim();
        if (!sentence) continue;
        const start = lineOffset + index + segment.indexOf(sentence);
        if (sentence.length <= 500) {units.push({start, end: start + sentence.length}); continue;}
        const words = [...sentence.matchAll(/\S+/gu)];
        let first = 0;
        while (first < words.length) {
          let last = first;
          while (last + 1 < words.length && words[last + 1]!.index + words[last + 1]![0].length - words[first]!.index <= 400) last++;
          const chunkStart = start + words[first]!.index;
          const chunkEnd = start + words[last]!.index + words[last]![0].length;
          if (chunkEnd - chunkStart <= 500) units.push({start: chunkStart, end: chunkEnd});
          first = last + 1;
        }
      }
      lineOffset += line.length + 1;
    }
    for (let index = 0; index < units.length; index++) {
      for (let extra = 0; extra < units.length; extra++) {
        const contexts: string[] = [];
        for (let left = Math.max(0, extra - (units.length - index - 1)); left <= Math.min(extra, index); left++) {
          const right = extra - left;
          contexts.push(text.slice(units[index - left]!.start, units[index + right]!.end));
        }
        contexts.sort((a,b) => a.length - b.length);
        if (!contexts.length || contexts[0]!.length > 500) break;
        const selected = contexts.find(candidate => candidate.length <= 500 && unique(candidate));
        if (selected) {anchors.add(selected); break;}
      }
    }
  }
  return [...anchors];
}
export function constrainRepairAnchors(texts: string[], schema: Record<string, unknown>): Record<string, unknown> {
  const scoped = structuredClone(schema) as any;
  scoped.properties.edits.items.properties.find.enum = ["", ...exactRepairAnchors(texts)];
  return scoped;
}

/** Corrections must replace existing wording in their owning field. Missing
 * care can still append, including into an empty field. Per-field branches keep
 * an anchor from another section from satisfying the schema accidentally. */
export function constrainNarrativeRepair(
  draft: Record<string, {text?: string; evidenceIds?: readonly string[]} | undefined>,
  schema: Record<string, unknown>,
  replacementFields: string[],
  protectedText: Partial<Record<string, string[]>> = {},
): Record<string, unknown> {
  const scoped = structuredClone(schema) as any;
  const item = scoped.properties.edits.items;
  const fields: string[] = item.properties.field.enum;
  const replacement = new Set(replacementFields);
  const branches = fields.flatMap(field => {
    const text = draft[field]?.text ?? "";
    const anchors = exactRepairAnchors([text]).filter(anchor => !(protectedText[field] ?? []).some(sentence => anchor.includes(sentence)));
    const finds = replacement.has(field) && text.trim() ? anchors : ["", ...anchors];
    // A correction with no unique anchor cannot be safely expressed as an
    // append. Omit that branch rather than admitting an ambiguous edit.
    if (!finds.length) return [];
    const branch = structuredClone(item);
    branch.properties.field.enum = [field];
    branch.properties.find.enum = finds;
    return [branch];
  });
  scoped.properties.edits.items = {anyOf: branches};
  return scoped;
}

/** Keep repair anchors with their owning card. A known defect in existing
 * wording needs an in-place correction; a second, appended instruction cannot
 * qualify an earlier unqualified recommendation or remove repeated advice. */
export function constrainCardRepair(
  cards: Array<{evidenceId: string; text: string}>,
  gaps: unknown,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const replacement = new Set<string>();
  if (Array.isArray(gaps)) for (const gap of gaps) {
    if (!gap || typeof gap !== "object") continue;
    const id = typeof gap.id === "string" ? gap.id : gap.evidenceId;
    if (typeof id !== "string" || !Array.isArray(gap.missing)) continue;
    if (gap.missing.some((reason: unknown) => typeof reason === "string"
      && /qualif|consolidat|repet|repeat(?:ed|s)\b|duplicat|remove|replac|unsafe|inaccur|incorrect|unqualified|narrower|SOURCE_FOOD_QUALIFICATION|INTERNAL_WORKFLOW_WORDING|REPEATED_SENTENCE/iu.test(reason))) replacement.add(id);
  }
  const scoped = structuredClone(schema) as any;
  const item = scoped.properties.edits.items;
  const branches = cards.flatMap(card => {
    const anchors = exactRepairAnchors([card.text]);
    const finds = replacement.has(card.evidenceId) ? anchors : ["", ...anchors];
    if (!finds.length) return [];
    const branch = structuredClone(item);
    branch.properties.evidenceId.enum = [card.evidenceId];
    branch.properties.find.enum = finds;
    return [branch];
  });
  scoped.properties.edits.items = {anyOf: branches};
  return scoped;
}

/** Whole-report source rows may expose gaps in several output components.
 * Keep source attribution separate from the exact component to repair. */
export function constrainCoverageComponents(schema: Record<string, unknown>, components: readonly string[]): Record<string, unknown> {
  const scoped = structuredClone(schema) as any;
  const escaped = components.map(component => component.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  scoped.properties.rows.items.properties.missing.items.pattern = `^\\[(?:${escaped.join("|")})\\]\\s+\\S`;
  return scoped;
}
