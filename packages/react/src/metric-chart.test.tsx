import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  calculateMonthlyRevenue,
  monthlyRevenueDefinition,
} from "@analyticool/core";
import { MetricChart, MetricKpi } from "./index";

const empty = calculateMonthlyRevenue(monthlyRevenueDefinition, {
  asOf: "2026-07-01",
  invoices: [],
});

describe("metric presentation", () => {
  it("preserves exact cents at the contract's numeric limit", () => {
    const result = calculateMonthlyRevenue(monthlyRevenueDefinition, {
      asOf: "2026-07-01",
      invoices: [
        {
          id: "large",
          amountCents: Number.MAX_SAFE_INTEGER,
          currency: "USD",
          status: "paid",
          paidAt: "2026-06-01T00:00:00Z",
        },
      ],
    });
    expect(renderToStaticMarkup(<MetricKpi result={result} />)).toContain(
      "$90,071,992,547,409.91",
    );
    expect(renderToStaticMarkup(<MetricChart result={result} />)).toContain(
      "$90,071,992,547,409.91",
    );
  });

  it("renders a zero series without invalid SVG coordinates and includes an exact-value table", () => {
    const html = renderToStaticMarkup(<MetricChart result={empty} />);
    expect(html).toContain('role="img"');
    expect(html).toContain("View exact values");
    expect(html).toContain("Jan 2026");
    expect(html).toContain("Jun 2026");
    expect(html).toContain("$0.00");
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("shows the latest month in the KPI and rejects invalid runtime results", () => {
    expect(renderToStaticMarkup(<MetricKpi result={empty} />)).toContain(
      "Jun 2026 collected revenue",
    );
    expect(() =>
      renderToStaticMarkup(<MetricChart result={{ ...empty, points: [] }} />),
    ).toThrow();
  });
});
