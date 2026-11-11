import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
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

  it("merges className and style onto the stable root of both components", () => {
    const style = { "--ac-series": "teal", margin: "4px" } as const;
    const chart = renderToStaticMarkup(
      <MetricChart result={empty} className="host-chart" style={style} />,
    );
    const kpi = renderToStaticMarkup(
      <MetricKpi result={empty} className="host-kpi" style={style} />,
    );
    expect(chart).toMatch(
      /^<figure class="ac-metric-chart host-chart" style="/,
    );
    expect(kpi).toMatch(/^<dl class="ac-metric-kpi host-kpi" style="/);
    for (const html of [chart, kpi]) {
      // style is merged last, so it overrides the inline margin reset.
      expect(html).toContain("margin:4px");
      expect(html).not.toContain("margin:0;");
      expect(html).toContain("--ac-series:teal");
    }
    expect(renderToStaticMarkup(<MetricKpi result={empty} />)).toMatch(
      /^<dl class="ac-metric-kpi" style="margin:0;/,
    );
  });

  it("exposes every documented part hook", () => {
    const chart = renderToStaticMarkup(<MetricChart result={empty} />);
    for (const part of [
      "caption",
      "plot",
      "grid",
      "axis",
      "series",
      "point",
      "details",
      "summary",
      "table",
    ]) {
      expect(chart).toContain(`data-ac-part="${part}"`);
    }
    const kpi = renderToStaticMarkup(<MetricKpi result={empty} />);
    expect(kpi).toContain('data-ac-part="label"');
    expect(kpi).toContain('data-ac-part="value"');
  });

  it("takes every colour, font and surface from --ac-* variables with neutral fallbacks", () => {
    const chart = renderToStaticMarkup(<MetricChart result={empty} />);
    const kpi = renderToStaticMarkup(<MetricKpi result={empty} />);
    for (const html of [chart, kpi]) {
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(html).not.toMatch(/rgba?\(|hsla?\(/i);
      expect(html).toContain("font-family:var(--ac-font, inherit)");
      expect(html).toContain("color:var(--ac-ink, inherit)");
      expect(html).toContain("background:var(--ac-surface, transparent)");
      // No product font, grain or background image is ever forced.
      expect(html).not.toMatch(/Geist|url\(|background-image/i);
      // Nothing global is injected and nothing moves.
      expect(html).not.toMatch(/<style|<link|<script/i);
      expect(html).not.toMatch(/transition|animation/i);
      // Every colour-bearing property reads a variable.
      const colours = [
        ...html.matchAll(
          /(?:[;"]|^)(?:color|fill|stroke|background|border-top):([^;"]+)/g,
        ),
      ].map(([, value]) => value);
      expect(colours.length).toBeGreaterThanOrEqual(3);
      for (const value of colours) expect(value).toContain("var(--ac-");
    }
    expect(chart).toMatch(
      /data-ac-part="series"[^>]*stroke:var\(--ac-series, currentColor\)/,
    );
    expect(chart).toMatch(
      /data-ac-part="point"[^>]*fill:var\(--ac-series, currentColor\)/,
    );
    expect(chart).toMatch(/data-ac-part="grid"[^>]*stroke:var\(--ac-grid,/);
    expect(chart).toMatch(/data-ac-part="axis"[^>]*fill:var\(--ac-muted,/);
    expect(kpi).toContain("font-size:var(--ac-figure-size, 2.25em)");
  });

  it("gives each point a native tooltip with the exact value", () => {
    const html = renderToStaticMarkup(<MetricChart result={empty} />);
    expect(html.match(/<title>/g)).toHaveLength(6);
    expect(html).toContain("<title>Jan 2026: $0.00</title>");
    expect(html).toContain("<title>Jun 2026: $0.00</title>");
  });

  it("keeps the CSS-free component source within its size budget", () => {
    // The package ships TypeScript source, not a bundle; this measures that.
    const source = readFileSync(new URL("./metric-chart.tsx", import.meta.url));
    const gzip = gzipSync(source, { level: 9 }).length;
    // Measured 7,923 B raw / 2,674 B gzip -9 for BRU-485; budget 3 KiB gzip.
    expect(gzip).toBeLessThanOrEqual(3072);
  });

  it("renders later published versions through the existing result components", () => {
    const result = calculateMonthlyRevenue(
      { ...monthlyRevenueDefinition, version: 2 },
      { asOf: "2026-07-01", invoices: [] },
    );
    expect(result.metricVersion).toBe(2);
    expect(renderToStaticMarkup(<MetricKpi result={result} />)).toContain(
      "$0.00",
    );
    expect(renderToStaticMarkup(<MetricChart result={result} />)).toContain(
      "Jun 2026",
    );
  });
});
