"use client";

import { useState } from "react";
import type {
  MonthlyRevenueDefinition,
  MonthlyRevenueResult,
} from "@analyticool/core";
import { MetricChart, MetricKpi } from "@analyticool/react";

interface MetricDemoProps {
  definition: MonthlyRevenueDefinition;
  result: MonthlyRevenueResult;
  assumptions: readonly string[];
}

const embedCode = `import type { MonthlyRevenueResult } from "@analyticool/core";
import { MetricChart, MetricKpi } from "@analyticool/react";

// Your application supplies a validated metric result.
// See lib/demo-metric.ts for the synthetic calculation.
export function Dashboard({ result }: { result: MonthlyRevenueResult }) {
  return (
    <section aria-label="Revenue dashboard">
      <MetricKpi result={result} />
      <MetricChart result={result} />
    </section>
  );
}`;

export function MetricDemo({
  definition,
  result,
  assumptions,
}: MetricDemoProps) {
  const [approved, setApproved] = useState(false);

  return (
    <div className="space-y-6">
      <ol
        aria-label="Metric workflow"
        className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"
      >
        {["Ask", "Build", "Validate", "Embed"].map((step, index) => (
          <li
            key={step}
            className={`rounded-lg border px-4 py-3 ${index === (approved ? 3 : 2) ? "border-slate-800 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}
            aria-current={index === (approved ? 3 : 2) ? "step" : undefined}
          >
            <span className="mr-2 opacity-60">0{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>

      <section
        aria-labelledby="question-heading"
        className="rounded-xl border border-slate-200 bg-white p-6"
      >
        <h2
          id="question-heading"
          className="text-sm font-semibold text-slate-500"
        >
          01 / Ask
        </h2>
        <p className="mt-3 text-xl font-medium">“{definition.question}”</p>
        <p className="mt-2 text-sm text-slate-500">
          This question maps to a predefined definition. No AI request is made.
        </p>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <section
          aria-labelledby="definition-heading"
          className="h-full rounded-xl border border-slate-200 bg-white p-6"
        >
          <h2 id="definition-heading" className="text-lg font-semibold">
            02 / Build: inspect the definition
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            <code>{definition.id}</code> · version {definition.version}
          </p>
          <pre
            className="mt-5 overflow-auto rounded-lg bg-slate-50 p-4 text-xs leading-6"
            tabIndex={0}
            aria-label="Typed metric definition"
          >
            <code>{JSON.stringify(definition, null, 2)}</code>
          </pre>
        </section>
        <section
          aria-labelledby="assumptions-heading"
          className="rounded-xl border border-slate-200 bg-white p-6"
        >
          <h2 id="assumptions-heading" className="text-lg font-semibold">
            03 / Validate: review the logic
          </h2>
          <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-slate-600">
            {assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
          <p className="mt-5 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-500">
            Source: fictional Acme workspace · fixed as-of date {result.asOf}.
            Runtime validation checks the definition, invoice records, and
            result.
          </p>
        </section>
      </div>

      <section
        aria-labelledby="preview-heading"
        className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8"
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 id="preview-heading" className="text-lg font-semibold">
            Result preview
          </h2>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
            Definition v{result.metricVersion} · UTC
          </span>
        </div>
        <MetricChart result={result} />
      </section>

      <section
        aria-labelledby="embed-heading"
        className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8"
      >
        <h2 id="embed-heading" className="text-lg font-semibold">
          04 / Embed in your dashboard
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Review the assumptions and exact values, then approve this fixture
          result to reveal a dashboard using the same React components.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => setApproved(!approved)}
            aria-controls="embed-preview"
            aria-expanded={approved}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            {approved ? "Reset demo approval" : "Approve demo metric"}
          </button>
          <p role="status" className="text-sm text-slate-500">
            {approved
              ? "Approved for this local demo session."
              : "Awaiting your review."}
          </p>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Approval is in-memory UI state and resets on reload. It is not an
          authorization or publishing boundary.
        </p>
        <div id="embed-preview" hidden={!approved}>
          {approved && (
            <>
              <section
                aria-label="Example revenue dashboard"
                className="mt-8 space-y-8 rounded-lg border border-slate-200 p-5 sm:p-6"
              >
                <div>
                  <p className="mb-4 text-xs font-medium tracking-wider text-slate-500 uppercase">
                    Acme / Revenue dashboard
                  </p>
                  <MetricKpi result={result} />
                </div>
                <MetricChart result={result} />
              </section>
              <h3 className="mt-6 text-sm font-semibold">
                Embed with explicit data
              </h3>
              <pre
                className="mt-3 overflow-auto rounded-lg bg-slate-950 p-5 text-xs leading-6 text-slate-200"
                tabIndex={0}
                aria-label="React embedding example"
              >
                <code>{embedCode}</code>
              </pre>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
