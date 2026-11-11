import type { CSSProperties } from "react";
import {
  monthlyRevenueResultSchema,
  type MonthlyRevenueResult,
} from "@analyticool/core";

/**
 * The documented, deliberately small set of CSS custom properties the
 * components read. Set them on any ancestor (or through `style`); every one has
 * a neutral fallback derived from the host's inherited font and colour.
 * See docs/design/embed-theming/README.md.
 */
export type MetricThemeVariable =
  | "--ac-font"
  | "--ac-ink"
  | "--ac-muted"
  | "--ac-line"
  | "--ac-grid"
  | "--ac-series"
  | "--ac-surface"
  | "--ac-radius"
  | "--ac-figure-size";

/** Typed helper for setting theme variables inline, e.g. `style={{ "--ac-series": "teal" }}`. */
export type MetricThemeVariables = Partial<Record<MetricThemeVariable, string>>;

export interface MetricChartProps {
  /** Validated data supplied by your application; this component never fetches. */
  result: MonthlyRevenueResult;
  /** Added to the stable root class (`ac-metric-chart` / `ac-metric-kpi`). */
  className?: string;
  /** Merged last onto the root, so it overrides the component's inline defaults. */
  style?: CSSProperties & MetricThemeVariables;
}

// Neutral fallbacks: inherit the host's font and colour; derive tints from it.
const v = {
  font: "var(--ac-font, inherit)",
  ink: "var(--ac-ink, inherit)",
  muted: "var(--ac-muted, color-mix(in srgb, currentColor 72%, transparent))",
  line: "var(--ac-line, color-mix(in srgb, currentColor 20%, transparent))",
  grid: "var(--ac-grid, color-mix(in srgb, currentColor 12%, transparent))",
  series: "var(--ac-series, currentColor)",
  surface: "var(--ac-surface, transparent)",
  radius: "var(--ac-radius, 0)",
  figureSize: "var(--ac-figure-size, 2.25em)",
} as const;

const rootStyle = (style: CSSProperties | undefined): CSSProperties => ({
  margin: 0,
  fontFamily: v.font,
  color: v.ink,
  background: v.surface,
  borderRadius: v.radius,
  ...style,
});

const rootClass = (base: string, className: string) =>
  className ? `${base} ${className}` : base;

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// Keep the last cent exact even at the contract's maximum safe integer value.
const money = (cents: number) =>
  `${wholeDollars.format(BigInt(cents) / 100n)}.${String(cents % 100).padStart(2, "0")}`;

const monthName = (month: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

/** A dependency-light SVG line chart with an accessible, exact-value table. */
export function MetricChart({
  result: input,
  className = "",
  style,
}: MetricChartProps) {
  const result = monthlyRevenueResultSchema.parse(input);
  const max = Math.max(1, ...result.points.map((point) => point.valueCents));
  const coordinates = result.points.map((point, index) => ({
    x: 90 + index * 112,
    y: 180 - (point.valueCents / max) * 150,
    ...point,
  }));

  return (
    <figure
      className={rootClass("ac-metric-chart", className)}
      style={rootStyle(style)}
    >
      <figcaption
        data-ac-part="caption"
        style={{ fontWeight: 600, marginBottom: 12 }}
      >
        Monthly collected revenue · USD
      </figcaption>
      <svg
        data-ac-part="plot"
        viewBox="0 0 700 225"
        role="img"
        aria-label="Monthly collected revenue in USD. Exact values are in the table below."
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              data-ac-part="grid"
              x1="90"
              y1={180 - fraction * 150}
              x2="650"
              y2={180 - fraction * 150}
              style={{ stroke: v.grid }}
            />
            <text
              data-ac-part="axis"
              x="78"
              y={184 - fraction * 150}
              textAnchor="end"
              fontSize="11"
              style={{ fill: v.muted }}
            >
              {money(Math.round(max * fraction))}
            </text>
          </g>
        ))}
        <polyline
          data-ac-part="series"
          points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}
          fill="none"
          strokeWidth="2.5"
          strokeLinejoin="round"
          style={{ stroke: v.series }}
        />
        {coordinates.map(({ x, y, month, valueCents }) => (
          <g key={month}>
            <circle
              data-ac-part="point"
              cx={x}
              cy={y}
              r="4"
              style={{ fill: v.series }}
            >
              <title>{`${monthName(month)}: ${money(valueCents)}`}</title>
            </circle>
            <text
              data-ac-part="axis"
              x={x}
              y="210"
              textAnchor="middle"
              fontSize="11"
              style={{ fill: v.muted }}
            >
              {monthName(month)}
            </text>
          </g>
        ))}
      </svg>
      <details data-ac-part="details" style={{ marginTop: 12 }}>
        <summary
          data-ac-part="summary"
          style={{ cursor: "pointer", fontSize: "0.875em" }}
        >
          View exact values
        </summary>
        <table
          data-ac-part="table"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: 12,
            fontSize: "0.875em",
          }}
        >
          <caption
            style={{ textAlign: "left", marginBottom: 8, color: v.muted }}
          >
            Six complete months · UTC · as of {result.asOf}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left", padding: "8px 0" }}>
                Month
              </th>
              <th scope="col" style={{ textAlign: "right", padding: "8px 0" }}>
                Collected revenue (USD)
              </th>
            </tr>
          </thead>
          <tbody>
            {result.points.map((point) => (
              <tr
                key={point.month}
                style={{ borderTop: `1px solid ${v.line}` }}
              >
                <th
                  scope="row"
                  style={{
                    textAlign: "left",
                    padding: "8px 0",
                    fontWeight: 400,
                  }}
                >
                  {monthName(point.month)}
                </th>
                <td
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {money(point.valueCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Latest complete month, not a six-month total or a recurring revenue measure. */
export function MetricKpi({
  result: input,
  className = "",
  style,
}: MetricChartProps) {
  const result = monthlyRevenueResultSchema.parse(input);
  const latest = result.points[result.points.length - 1];
  if (!latest) throw new Error("Monthly revenue must contain six points.");
  return (
    <dl
      className={rootClass("ac-metric-kpi", className)}
      style={rootStyle(style)}
    >
      <dt data-ac-part="label" style={{ fontSize: "0.875em", color: v.muted }}>
        {monthName(latest.month)} collected revenue
      </dt>
      <dd
        data-ac-part="value"
        style={{
          margin: "8px 0 0",
          fontSize: v.figureSize,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {money(latest.valueCents)}
      </dd>
    </dl>
  );
}
