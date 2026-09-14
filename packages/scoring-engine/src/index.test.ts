import { describe, expect, test } from "bun:test";
import type { ProvisionalScoringInput } from "@niq-scoring/contracts";
import { PROVISIONAL_RULE_CHECKSUM, PROVISIONAL_SCORING_VERSION, PROVISIONAL_VERSION_STATUS } from "@niq-scoring/contracts/metadata";
import { calculateProvisionalScore } from "./index";

const base: ProvisionalScoringInput = {
  assessmentReference: "assessment-pseudonym-001",
  clientId: "550e8400-e29b-41d4-a716-446655440000",
  heightCm: 170,
  weightKg: 70,
  weightTrend: "stable",
  weightChangePercent: null,
  intakeLevel: "normal",
  appetite: "good",
  functionalStatus: "fully_active",
  cancerStage: "Unknown",
  albumin: null,
  crp: null,
  fluidStatus: { edema: false, ascites: false, pleuralEffusion: false, pericardialEffusion: false, hypoalbuminemia: false },
  symptoms: { nausea: false, vomiting: false, mucositis: false, dysphagia: false, earlySatiety: false, diarrhea: false, constipation: false, tasteChange: false, painWithEating: false, fatigue: false },
};

describe("NIQ-DRAFT-2026-09", () => {
  test("published checksum is bound to the canonical manifest bytes", async () => {
    const file = Bun.file(new URL("../rules/NIQ-DRAFT-2026-09.json", import.meta.url));
    const bytes = await file.arrayBuffer();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(bytes);
    expect(hasher.digest("hex")).toBe(PROVISIONAL_RULE_CHECKSUM);
    const manifest = JSON.parse(await file.text()) as { version: string; status: string; clinicalUsePermitted: boolean };
    expect(manifest).toMatchObject({ version: PROVISIONAL_SCORING_VERSION, status: PROVISIONAL_VERSION_STATUS, clinicalUsePermitted: false });
  });
  test("is deterministic and explicitly non-clinical", () => {
    const at = "2026-09-13T00:00:00.000Z";
    expect(calculateProvisionalScore(base, at)).toEqual(calculateProvisionalScore(base, at));
    expect(calculateProvisionalScore(base, at)).toMatchObject({
      score: 0,
      band: "Low",
      version: "NIQ-DRAFT-2026-09",
      versionStatus: "DRAFT_NON_CLINICAL",
      clinicalUsePermitted: false,
      bmi: 24.22,
    });
  });

  test("caps the prototype score and explains every contribution", () => {
    const result = calculateProvisionalScore({
      ...base,
      weightKg: 45,
      weightTrend: "loss",
      weightChangePercent: 12,
      intakeLevel: "nil_by_mouth",
      appetite: "none",
      functionalStatus: "disabled",
      cancerStage: "Metastatic (Stage IV)",
      albumin: 2.8,
      crp: 20,
      fluidStatus: { ...base.fluidStatus, edema: true, ascites: true },
      symptoms: Object.fromEntries(Object.keys(base.symptoms).map((key) => [key, true])) as ProvisionalScoringInput["symptoms"],
    }, "2026-09-13T00:00:00.000Z");
    expect(result.score).toBe(100);
    expect(result.band).toBe("Critical");
    expect(result.components.length).toBeGreaterThan(5);
    expect(result.components.every((component) => component.explanation.length > 0)).toBe(true);
  });
});
