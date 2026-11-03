import {
  monthlyRevenueResultSchema,
  type MonthlyRevenueResult,
} from "@analyticool/core";

export interface MetricChartProps {
  /** Validated data supplied by your application; this component never fetches. */
  result: MonthlyRevenueResult;
  className?: string;
}

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
}: MetricChartProps) {
  const result = monthlyRevenueResultSchema.parse(input);
  const max = Math.max(1, ...result.points.map((point) => point.valueCents));
  const coordinates = result.points.map((point, index) => ({
    x: 90 + index * 112,
    y: 180 - (point.valueCents / max) * 150,
    ...point,
  }));

  return (
    <figure className={className} style={{ margin: 0, color: "#334155" }}>
      <figcaption style={{ fontWeight: 600, marginBottom: 12 }}>
        Monthly collected revenue · USD
      </figcaption>
      <svg
        viewBox="0 0 700 225"
        role="img"
        aria-label="Monthly collected revenue in USD. Exact values are in the table below."
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="90"
              y1={180 - fraction * 150}
              x2="650"
              y2={180 - fraction * 150}
              stroke="#e2e8f0"
            />
            <text
              x="78"
              y={184 - fraction * 150}
              textAnchor="end"
              fill="currentColor"
              fontSize="11"
            >
              {money(Math.round(max * fraction))}
            </text>
          </g>
        ))}
        <polyline
          points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {coordinates.map(({ x, y, month }) => (
          <g key={month}>
            <circle cx={x} cy={y} r="4" fill="currentColor" />
            <text
              x={x}
              y="210"
              textAnchor="middle"
              fill="currentColor"
              fontSize="11"
            >
              {monthName(month)}
            </text>
          </g>
        ))}
      </svg>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 14 }}>
          View exact values
        </summary>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: 12,
            fontSize: 14,
          }}
        >
          <caption style={{ textAlign: "left", marginBottom: 8 }}>
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
              <tr key={point.month} style={{ borderTop: "1px solid #e2e8f0" }}>
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
export function MetricKpi({ result: input, className = "" }: MetricChartProps) {
  const result = monthlyRevenueResultSchema.parse(input);
  const latest = result.points[result.points.length - 1];
  if (!latest) throw new Error("Monthly revenue must contain six points.");
  return (
    <dl className={className} style={{ margin: 0 }}>
      <dt style={{ fontSize: 14, color: "#475569" }}>
        {monthName(latest.month)} collected revenue
      </dt>
      <dd
        style={{
          margin: "8px 0 0",
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          color: "#0f172a",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {money(latest.valueCents)}
      </dd>
    </dl>
  );
}
