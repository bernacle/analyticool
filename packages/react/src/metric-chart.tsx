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

const shortMonth = (month: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

// Readable floor from Darkroom SPEC §2: nothing that is read is under 12px.
const axisFontSize = "max(12px, 0.75em)";

/** A dependency-light SVG line chart with an accessible, exact-value table. */
export function MetricChart({
  result: input,
  className = "",
  style,
}: MetricChartProps) {
  const result = monthlyRevenueResultSchema.parse(input);
  const max = Math.max(1, ...result.points.map((point) => point.valueCents));
  const count = result.points.length;
  // Percent coordinates: x is the centre of each month's column, y runs from
  // the maximum (0%) to zero (100%). HTML labels use the same percentages.
  const coordinates = result.points.map((point, index) => ({
    x: ((index + 0.5) / count) * 100,
    y: (1 - point.valueCents / max) * 100,
    ...point,
  }));
  const ticks = [1, 0.5, 0].map((fraction) => ({
    fraction,
    label: wholeDollars.format(BigInt(Math.round(max * fraction)) / 100n),
  }));

  return (
    <figure
      className={rootClass("ac-metric-chart", className)}
      style={rootStyle(style)}
    >
      <figcaption
        data-ac-part="caption"
        style={{ fontWeight: 600, marginBottom: 16 }}
      >
        Monthly collected revenue · USD
      </figcaption>
      {/*
        Axis labels are HTML, not SVG text, so they never scale with the chart:
        they stay at max(12px, 0.75em) at any width. Only the line layer
        stretches; its strokes and the points keep their pixel size.
      */}
      <div
        data-ac-part="plot"
        role="img"
        aria-label="Monthly collected revenue in USD. Exact values are in the table below."
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          columnGap: 8,
          fontSize: axisFontSize,
          lineHeight: 1.3,
        }}
      >
        <div aria-hidden="true" style={{ position: "relative" }}>
          {/* In-flow sizer: absolutely positioned ticks do not size the column. */}
          <span style={{ visibility: "hidden", whiteSpace: "nowrap" }}>
            {ticks[0]?.label}
          </span>
          {ticks.map(({ fraction, label }) => (
            <span
              key={fraction}
              data-ac-part="axis"
              style={{
                position: "absolute",
                right: 0,
                top: `${(1 - fraction) * 100}%`,
                transform: "translateY(-50%)",
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
                color: v.muted,
              }}
            >
              {label}
            </span>
          ))}
        </div>
        <div style={{ position: "relative", height: 180 }}>
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              overflow: "visible",
            }}
          >
            {ticks.map(({ fraction }) => (
              <line
                key={fraction}
                data-ac-part="grid"
                x1="0"
                y1={(1 - fraction) * 100}
                x2="100"
                y2={(1 - fraction) * 100}
                vectorEffect="non-scaling-stroke"
                strokeWidth="1"
                style={{ stroke: v.grid }}
              />
            ))}
            <polyline
              data-ac-part="series"
              points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}
              fill="none"
              strokeWidth="2.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: v.series }}
            />
          </svg>
          {coordinates.map(({ x, y, month, valueCents }) => (
            // One fixed 10px SVG per point, so points stay round at any size.
            <svg
              key={month}
              width="10"
              height="10"
              viewBox="0 0 10 10"
              style={{
                position: "absolute",
                left: `${x}%`,
                top: `${y}%`,
                margin: "-5px 0 0 -5px",
                overflow: "visible",
              }}
            >
              <circle
                data-ac-part="point"
                cx="5"
                cy="5"
                r="4"
                style={{ fill: v.series }}
              >
                <title>{`${monthName(month)}: ${money(valueCents)}`}</title>
              </circle>
            </svg>
          ))}
        </div>
        <div
          aria-hidden="true"
          style={{
            gridColumn: 2,
            display: "grid",
            gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
            marginTop: 8,
            textAlign: "center",
          }}
        >
          {coordinates.map(({ month }, index) => (
            <span
              key={month}
              data-ac-part="axis"
              style={{ color: v.muted, whiteSpace: "nowrap" }}
            >
              {shortMonth(month)}
              {/* The year only where it changes, so labels fit at 390px. */}
              {index === 0 || month.endsWith("-01") ? (
                <>
                  <br />
                  {month.slice(0, 4)}
                </>
              ) : null}
            </span>
          ))}
        </div>
      </div>
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
