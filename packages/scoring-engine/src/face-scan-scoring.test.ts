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
    expect(calculateFaceScanScore({ wellnessScore }, config, "rule-v2")).toMatchObject({ points, scoringVersion: null, ruleVersionId: "rule-v2", configuration: config });
  }
  expect(calculateFaceScanScore({}, config)).toMatchObject({ status: "UNAVAILABLE", points: null, configuration: config });
  expect(calculateFaceScanScore({ wellnessScore: 80 })).toMatchObject({ scoringVersion: "NIQ_FACE_SCAN_2026_09", points: 2 });
});

test("invalid face-scan configurations cannot be evaluated even with an absent score", () => {
  const config = { lowerThreshold: 70, upperThreshold: 80, belowPoints: 3, middlePoints: 2, abovePoints: 1 };
  for (const changes of [{ lowerThreshold: 80 }, { upperThreshold: 60 }, { lowerThreshold: -1 }, { upperThreshold: 101 }, { belowPoints: -1 }, { middlePoints: 1.5 }, { abovePoints: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect(() => calculateFaceScanScore({}, { ...config, ...changes })).toThrow();
  }
});
