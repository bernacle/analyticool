import { expect, it } from "vitest";
import { monthlyRevenueDefinition } from "@analyticool/core";
import { getDemoMetric } from "./demo-metric";

it("calculates the reproducible demo without the other fictional workspace or excluded invoices", () => {
  expect(getDemoMetric().points.map((point) => point.valueCents)).toEqual([
    200_000, 225_000, 249_000, 275_000, 310_000, 342_000,
  ]);
  expect(getDemoMetric().asOf).toBe("2026-07-01");
});

it("executes published revisions over the same fixed synthetic workspace", () => {
  const revised = getDemoMetric({ ...monthlyRevenueDefinition, version: 2 });
  expect(revised.points).toEqual(getDemoMetric().points);
  expect(revised.metricVersion).toBe(2);
});
