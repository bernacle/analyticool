import type { MonthlyRevenueResult } from "@analyticool/core";
import { MetricChart, MetricKpi } from "@analyticool/react";

// Calculate `result` on your server with calculateMonthlyRevenue(definition,
// { asOf, invoices }) over records you are authorized to show.
export function RevenueDashboard({ result }: { result: MonthlyRevenueResult }) {
  return (
    <section aria-label="Revenue dashboard">
      <MetricKpi result={result} />
      <MetricChart result={result} />
    </section>
  );
}
