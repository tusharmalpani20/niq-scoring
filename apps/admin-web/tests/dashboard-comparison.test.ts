import { expect, test } from "bun:test";
import { metricComparison } from "../src/dashboard-comparison";

const previous = { assessments: 0, faceScans: 2, failedRequests: 0 };

test("uses exact comparison counts from the updated API", () => {
  expect(metricComparison({ previous: "2026-08", asOf: "2026-09-24T12:00:00Z", comparisonEnd: "2026-08-24T12:00:00Z" }, previous, "faceScans"))
    .toEqual({ end: "2026-08-24T12:00:00Z", count: 2 });
});

test("legacy API zero totals can be compared safely while nonzero totals cannot", () => {
  const period = { previous: "2026-08", asOf: "2026-09-24T12:00:00Z" };
  expect(metricComparison(period, previous, "assessments")).toEqual({ end: "2026-08-24T12:00:00.000Z", count: 0 });
  expect(metricComparison(period, previous, "faceScans")).toBeNull();
});

test("does not invent a comparison when the previous month was shorter", () => {
  expect(metricComparison({ previous: "2026-02", asOf: "2026-03-31T12:00:00Z" }, previous, "assessments")).toBeNull();
  expect(metricComparison({ previous: "2026-02", asOf: "2026-03-31T12:00:00Z", comparisonEnd: null }, previous, "assessments")).toBeNull();
});
