import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardMetricCard } from "../src/DashboardMetricCard";

const monthly = Array.from({ length: 6 }, () => ({ assessments: 0, faceScans: 0, failedRequests: 0 }));

test("metric omits a trend when no matching previous period is available", () => {
  const html = renderToStaticMarkup(<DashboardMetricCard label="Assessments scored" metric="assessments" current={7} previous={null} monthly={monthly} comparisonPeriod="" />);
  expect(html).toContain("Assessments scored");
  expect(html).not.toContain("vs ");
  expect(html).not.toContain("equal-length");
  expect(html).toContain("monthly totals for the last six months, with the current month to date");
});

test("metric keeps a compact label for a matching previous period", () => {
  const html = renderToStaticMarkup(<DashboardMetricCard label="Assessments scored" metric="assessments" current={7} previous={0} monthly={monthly} comparisonPeriod="Aug 1–24" />);
  expect(html).toContain("vs Aug 1–24 (0)");
  expect(html).not.toContain("same period in");
});
