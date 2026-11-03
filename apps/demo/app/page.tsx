import {
  monthlyRevenueDefinition,
  revenueAssumptions,
} from "@analyticool/core";
import { getDemoMetric } from "../lib/demo-metric";
import { MetricDemo } from "./metric-demo";

export default function Home() {
  const result = getDemoMetric();
  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
      <header className="mb-12">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <span className="text-lg font-semibold tracking-tight">
            Analyticool
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
            Open-source prototype · synthetic data
          </span>
        </div>
        <h1 className="max-w-2xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          Describe a metric. Verify the logic. Embed it in your app.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
          One business question, one readable definition, one reusable React
          component. Explore the workflow with a predefined metric and fictional
          SaaS payments.
        </p>
      </header>
      <MetricDemo
        definition={monthlyRevenueDefinition}
        result={result}
        assumptions={revenueAssumptions}
      />
      <footer className="mt-10 border-t border-slate-200 pt-6 text-sm leading-6 text-slate-500">
        Analyticool is a working name. AI generation, database connections, and
        persistent approvals are future work. Visual exploration is tracked in
        BRU-456.
      </footer>
    </main>
  );
}
