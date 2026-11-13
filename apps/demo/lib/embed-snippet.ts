/**
 * The copyable React embed sample for the current result-prop SDK.
 * It must stay identical to ./embed-example.tsx, which `pnpm typecheck`
 * compiles against @analyticool/core and @analyticool/react
 * (enforced by embed-snippet.test.ts).
 */
export const EMBED_SNIPPET = `import type { MonthlyRevenueResult } from "@analyticool/core";
import { MetricChart, MetricKpi } from "@analyticool/react";

// Calculate \`result\` on your server with calculateMonthlyRevenue(definition,
// { asOf, invoices }) over records you are authorized to show.
export function RevenueDashboard({ result }: { result: MonthlyRevenueResult }) {
  return (
    <section aria-label="Revenue dashboard">
      <MetricKpi result={result} />
      <MetricChart result={result} />
    </section>
  );
}
`;
