import { DEFAULT_FACE_SCAN_SCORING_CONFIG, faceScanRangeConfigSchema, normalizeFaceScanScoringConfig } from "@niq-scoring/contracts/face-scan-scoring";
import { describe, expect, test } from "bun:test";
import { calculateFaceScanScore } from "./face-scan-scoring";

describe("independent face-scan scoring", () => {
  test.each([[0, 3], [69.999, 3], [70, 2], [75, 2], [80, 2], [80.001, 1], [84, 1], [100, 1]])("%s percent returns %s points", (wellnessScore, points) => {
    expect(calculateFaceScanScore({ wellnessScore })).toMatchObject({ status: "SCORED", wellnessScore, points });
  });
  test("missing is unavailable, never zero or healthy", () => {
    for (const input of [{}, { wellnessScore: null }]) expect(calculateFaceScanScore(input)).toMatchObject({ status: "UNAVAILABLE", wellnessScore: null, points: null });
  });
  test("rejects invalid scores and unrelated provider or assessment values", () => {
    for (const wellnessScore of [-1, 101, NaN, Infinity, "84", false]) expect(() => calculateFaceScanScore({ wellnessScore })).toThrow();
    expect(() => calculateFaceScanScore({ health_risk_score: 84 })).toThrow();
    expect(() => calculateFaceScanScore({ wellnessScore: 84, assessmentScore: 20 })).toThrow();
  });
});


test("versioned custom face-scan settings govern decimal boundaries and preserve evidence", () => {
  const config = { lowerThreshold: 65.5, upperThreshold: 85.5, belowPoints: 9, middlePoints: 4, abovePoints: 0 };
  for (const [wellnessScore, points] of [[65.499, 9], [65.5, 4], [85.5, 4], [85.501, 0]]) {
    expect(calculateFaceScanScore({ wellnessScore }, config, "rule-v2")).toMatchObject({ points, scoringVersion: null, ruleVersionId: "rule-v2", configuration: normalizeFaceScanScoringConfig(config) });
  }
  expect(calculateFaceScanScore({}, config)).toMatchObject({ status: "UNAVAILABLE", points: null, configuration: normalizeFaceScanScoringConfig(config) });
  expect(calculateFaceScanScore({ wellnessScore: 80 })).toMatchObject({ scoringVersion: "NIQ_FACE_SCAN_2026_09", points: 2 });
});

test("invalid face-scan configurations cannot be evaluated even with an absent score", () => {
  const config = { lowerThreshold: 70, upperThreshold: 80, belowPoints: 3, middlePoints: 2, abovePoints: 1 };
  for (const changes of [{ lowerThreshold: 80 }, { upperThreshold: 60 }, { lowerThreshold: -1 }, { upperThreshold: 101 }, { belowPoints: -1 }, { middlePoints: 1.5 }, { abovePoints: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect(() => calculateFaceScanScore({}, { ...config, ...changes })).toThrow();
  }
});


test("editable rows allow added categories and exact continuous coverage", () => {
  const configuration = { ranges: [
    { id: "a", min: 0, max: 25, minInclusive: true, maxInclusive: false, points: 8 },
    { id: "b", min: 25, max: 50, minInclusive: true, maxInclusive: false, points: 5 },
    { id: "c", min: 50, max: 75, minInclusive: true, maxInclusive: true, points: 2 },
    { id: "d", min: 75, max: 100, minInclusive: false, maxInclusive: true, points: 0 },
  ] };
  for (const [wellnessScore, points] of [[0, 8], [24.999, 8], [25, 5], [50, 2], [75, 2], [75.001, 0], [100, 0]]) {
    expect(calculateFaceScanScore({ wellnessScore }, configuration)).toMatchObject({ points, configuration, scoringVersion: null });
  }
  expect(calculateFaceScanScore({ wellnessScore: 50 }, { ranges: [{ id: "all", min: 0, max: 100, minInclusive: true, maxInclusive: true, points: 0 }] }).points).toBe(0);
});

test("rows reject gaps, overlaps, omitted endpoints, duplicates and empty intervals", () => {
  for (const update of [
    { min: 71 }, { min: 69 }, { minInclusive: false }, { maxInclusive: false }, { id: "below" },
    { min: 80, max: 70 }, { min: 70, max: 70, minInclusive: true, maxInclusive: false },
  ]) {
    const config = structuredClone(DEFAULT_FACE_SCAN_SCORING_CONFIG);
    Object.assign(config.ranges[1]!, update);
    expect(faceScanRangeConfigSchema.safeParse(config).success).toBe(false);
  }
  for (const [index, update] of [[0, { minInclusive: false }], [2, { maxInclusive: false }]] as const) {
    const config = structuredClone(DEFAULT_FACE_SCAN_SCORING_CONFIG);
    Object.assign(config.ranges[index]!, update);
    expect(faceScanRangeConfigSchema.safeParse(config).success).toBe(false);
  }
  expect(faceScanRangeConfigSchema.safeParse({ ranges: [] }).success).toBe(false);
});

test("legacy cutoffs normalize without mutation including endpoint thresholds", () => {
  const legacy = { lowerThreshold: 0, upperThreshold: 100, belowPoints: 3, middlePoints: 2, abovePoints: 1 };
  const original = structuredClone(legacy);
  const normalized = normalizeFaceScanScoringConfig(legacy);
  expect(faceScanRangeConfigSchema.safeParse(normalized).success).toBe(true);
  expect(normalized.ranges).toHaveLength(1);
  expect(calculateFaceScanScore({ wellnessScore: 0 }, legacy).points).toBe(2);
  expect(calculateFaceScanScore({ wellnessScore: 100 }, legacy).points).toBe(2);
  expect(legacy).toEqual(original);
});

test('labels explain ranges without changing their scores or original mapping identity', () => {
  const configuration = { ranges: DEFAULT_FACE_SCAN_SCORING_CONFIG.ranges.map((range, index) => ({ ...range, label: index === 0 ? 'Needs attention' : '' })) };
  expect(calculateFaceScanScore({ wellnessScore: 64 }, configuration)).toMatchObject({ points: 3, scoringVersion: 'NIQ_FACE_SCAN_2026_09', configuration });
  expect(calculateFaceScanScore({ wellnessScore: 84 }, configuration)).toMatchObject({ points: 1, scoringVersion: 'NIQ_FACE_SCAN_2026_09' });
});
