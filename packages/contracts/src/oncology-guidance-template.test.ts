import { describe, expect, test } from "bun:test";
import { initialOncologyGuidance, oncologyGuidanceSchema } from "./oncology-guidance-template";

describe("oncology workbook guidance defaults", () => {
  test("covers each of 16 drug classes at each nutritional status and all radiotherapy states", () => {
    const defaults = initialOncologyGuidance();
    expect(oncologyGuidanceSchema.safeParse(defaults).success).toBe(true);
    expect(defaults.statusModifiers).toHaveLength(48);
    expect(defaults.radiotherapy).toHaveLength(3);
    const statuses = ["well_nourished", "moderately_nourished", "severely_malnourished"];
    const classIds = new Set(defaults.statusModifiers.map(row => row.classId));
    expect(classIds.size).toBe(16);
    for (const classId of classIds) {
      expect(defaults.statusModifiers.filter(row => row.classId === classId).map(row => row.nutritionalStatus).sort()).toEqual([...statuses].sort());
    }
    expect(defaults.radiotherapy.map(row => row.nutritionalStatus).sort()).toEqual([...statuses].sort());
    expect(new Set([...defaults.statusModifiers, ...defaults.radiotherapy].map(row => row.id)).size).toBe(51);
  });

  test("keeps named-drug instructions and product doses out of report-ready wording", () => {
    const defaults = initialOncologyGuidance();
    const text = defaults.statusModifiers.map(row => `${row.riskEmphasis}\n${row.actions}`).join("\n");
    expect(text).not.toMatch(/\b(?:cyclophosphamide|ifosfamide|oxaliplatin|capecitabine|irinotecan|niraparib|pertuzumab|abiraterone|palbociclib|ribociclib|abemaciclib|levothyroxine|T-DM1|T-DXd)\b/i);
    expect(text).not.toMatch(/\b(?:Invigour|Liss WH|Nourish|Protect|Recover)\b/i);
    expect(text).not.toMatch(/\b(?:drug.food rules|food timing|grapefruit|as above)\b/i);
    expect(defaults.statusModifiers.every(row => row.source.document.endsWith(".ods") && row.source.location.startsWith("Status_modifier row "))).toBe(true);
  });

  test("returns editable independent copies", () => {
    const first = initialOncologyGuidance();
    first.statusModifiers[0].actions = "Changed";
    first.radiotherapy[0].guidance = "Changed";
    const second = initialOncologyGuidance();
    expect(second.statusModifiers[0].actions).not.toBe("Changed");
    expect(second.radiotherapy[0].guidance).not.toBe("Changed");
  });

  test("class guidance keeps the workbook monitoring and independent instructions", () => {
    const rows = new Map(initialOncologyGuidance().statusModifiers.map(row => [row.source.location, row.actions]));
    expect(rows.get("Status_modifier row 3")).toContain("re-screen nutritional status each cycle");
    expect(rows.get("Status_modifier row 18")).toContain("keep ORS at home");
    expect(rows.get("Status_modifier row 24")).toContain("Fortified small frequent meals");
    expect(rows.get("Status_modifier row 36")).toContain("intake stays below 60% of needs for 1–2 weeks");
    expect(rows.get("Status_modifier row 46")).toContain("baseline handgrip strength");
    expect(rows.get("Status_modifier row 48")).toContain("Small frequent meals");
    expect(rows.get("Status_modifier row 49")).toContain("Review CBC per the oncology schedule");
    for (const actions of rows.values()) {
      expect(actions).not.toMatch(/same (?:diarrhea )?plan|same day•|immediately as tolerated|treatment resistance exercise/i);
    }
  });
});
