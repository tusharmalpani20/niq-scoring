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
