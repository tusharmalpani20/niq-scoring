import { z } from "zod";
import type { InterventionSummary } from "./report-coverage";

export const CARD_PATCH_POLICY = `Return exact card edits only. All find anchors refer to the supplied original card text, never to wording introduced by another edit. Appends retain their listed order. Each edit contains evidenceId, find (one exact unique substring, at most 500 characters), and replace. Use find="" to append a missing source-supported instruction when the existing wording is already correct. When correcting unsafe, incomplete or inaccurate existing wording, replace the rejected sentence itself rather than appending a clarification that leaves the original instruction unchanged. Fix only listed gaps. Preserve existing clinical quantities, warnings, conditions, food texture, temperature, preparation and qualifications inside the replaced anchor as well as outside it, unless the source-supported correction explicitly changes them. For example, adding a missing preparation qualification must not remove an existing tolerance condition or soft-food instruction. Do not rewrite a card or refer to another section instead of giving care.`;

const patchSchema = z.object({edits: z.array(z.object({
  evidenceId: z.string(), find: z.string().max(500), replace: z.string().max(4000),
}).strict()).max(40)}).strict();

export const cardPatchJsonSchema = {
  type: "object", additionalProperties: false, required: ["edits"], properties: {
    edits: {type: "array", maxItems: 40, items: {
      type: "object", additionalProperties: false, required: ["evidenceId", "find", "replace"], properties: {
        evidenceId: {type: "string"}, find: {type: "string", maxLength: 500},
        replace: {type: "string", maxLength: 4000},
      },
    }},
  },
};

/** Resolve all anchors against original cards. A replacement cannot become a
 * later anchor or make an originally unique anchor ambiguous. Overlapping or
 * invalid ranges reject the entire transaction before any card is changed. */
export function applyCardPatches(current: InterventionSummary[], value: unknown): InterventionSummary[] | null {
  const parsed = patchSchema.safeParse(value);
  if (!parsed.success) return null;
  const originals = new Map(current.map(row => [row.evidenceId, row]));
  if (originals.size !== current.length) return null;
  const plans = new Map<string, {ranges: Array<{start: number; end: number; replace: string}>; appends: string[]}>();
  for (const edit of parsed.data.edits) {
    const row = originals.get(edit.evidenceId);
    if (!row || (!edit.find && !edit.replace.trim())) return null;
    let plan = plans.get(edit.evidenceId);
    if (!plan) {plan = {ranges: [], appends: []}; plans.set(edit.evidenceId, plan);}
    if (edit.find) {
      const start = row.text.indexOf(edit.find);
      if (start < 0 || row.text.indexOf(edit.find, start + 1) >= 0) return null;
      const end = start + edit.find.length;
      if (plan.ranges.some(range => start < range.end && end > range.start)) return null;
      plan.ranges.push({start, end, replace: edit.replace});
    } else plan.appends.push(edit.replace.trim());
  }
  return current.map(row => {
    const plan = plans.get(row.evidenceId);
    if (!plan) return {...row};
    let text = row.text;
    for (const range of plan.ranges.sort((left, right) => right.start - left.start)) {
      text = text.slice(0, range.start) + range.replace + text.slice(range.end);
    }
    return {...row, text: [text.trim(), ...plan.appends].filter(Boolean).join(" ")};
  });
}
