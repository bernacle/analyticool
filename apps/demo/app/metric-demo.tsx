"use client";

import { useState } from "react";
import {
  approveMetricProposal,
  generateMetricProposal,
  proposalExamples,
  publishMetricProposal,
  rejectMetricProposal,
  resolveMetricClarification,
  reviseMetricVersion,
  submitMetricProposal,
  validateProposalDefinition,
  type MetricProposal,
  type PublishedMetricVersion,
} from "@analyticool/core";
import { MetricChart, MetricKpi } from "@analyticool/react";
import { demoAsOf, getDemoMetric } from "../lib/demo-metric";

const buttonClass =
  "rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40";
const panelClass = "rounded-xl border border-slate-200 bg-white p-6";
const embedCode = `import type { MonthlyRevenueResult } from "@analyticool/core";
import { MetricChart, MetricKpi } from "@analyticool/react";

// Calculate with the published definition and your authorized records.
export function Dashboard({ result }: { result: MonthlyRevenueResult }) {
  return (
    <section aria-label="Revenue dashboard">
      <MetricKpi result={result} />
      <MetricChart result={result} />
    </section>
  );
}`;

export function MetricDemo() {
  const [request, setRequest] = useState<string>(
    proposalExamples.monthlyRevenue,
  );
  const [proposal, setProposal] = useState<MetricProposal | null>(null);
  const [history, setHistory] = useState<PublishedMetricVersion[]>([]);
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const latest = history.at(-1);
  const result = latest ? getDemoMetric(latest.definition) : null;
  const issues = proposal ? validateProposalDefinition(proposal) : [];
  const canReject =
    proposal &&
    ["draft", "needs_clarification", "ready_for_review"].includes(
      proposal.status,
    );
  const isPublished = latest?.proposal.id === proposal?.id;

  // Lifecycle transitions run once per event, outside React state updater callbacks.
  function act(action: () => void) {
    try {
      action();
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update proposal.",
      );
    }
  }

  return (
    <div className="space-y-6">
      <ol
        aria-label="Metric workflow"
        className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"
      >
        {["Ask", "Build", "Validate", "Embed"].map((step, index) => (
          <li
            key={step}
            className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-600"
          >
            <span className="mr-2 opacity-60">0{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>

      <section aria-labelledby="question-heading" className={panelClass}>
        <h2 id="question-heading" className="text-lg font-semibold">
          01 / Ask
        </h2>
        <label
          htmlFor="business-question"
          className="mt-4 block text-sm font-medium"
        >
          Business question
        </label>
        <select
          id="business-question"
          value={request}
          disabled={proposal !== null}
          onChange={(event) => setRequest(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm"
        >
          {Object.values(proposalExamples).map((example) => (
            <option key={example}>{example}</option>
          ))}
        </select>
        <p className="mt-3 text-sm text-slate-500">
          Two deterministic fixture scenarios. No AI request is made.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={proposal !== null}
            className={buttonClass}
            onClick={() =>
              act(() =>
                setProposal(generateMetricProposal(request, "demo-proposal-1")),
              )
            }
          >
            Generate proposal
          </button>
          {proposal && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setProposal(null);
                setHistory([]);
                setRejectionReason("");
                setError(null);
              }}
            >
              Start over
            </button>
          )}
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          All proposals and publications are local to this session. Start over
          or reload to clear them. This is not an authorization boundary.
        </p>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-slate-600">
        {proposal
          ? `Proposal ${proposal.id} · ${proposal.status} · version ${proposal.metricVersion}${isPublished ? " · published" : ""}`
          : "Choose a question to generate a draft."}
      </p>

      {proposal && (
        <>
          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
            <section
              aria-labelledby="definition-heading"
              className={`${panelClass} min-w-0`}
            >
              <h2 id="definition-heading" className="text-lg font-semibold">
                02 / Build: inspect the proposal
              </h2>
              <p className="mt-3 text-sm font-medium">
                {proposal.definition?.name ??
                  "Net revenue by customer: definition unresolved"}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Original request: “{proposal.originalRequest}”
              </p>
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-medium">
                  Inspect typed proposal
                </summary>
                <pre
                  className="mt-3 overflow-auto rounded-lg bg-slate-50 p-4 text-xs leading-6"
                  tabIndex={0}
                  aria-label="Typed metric proposal"
                >
                  <code>{JSON.stringify(proposal, null, 2)}</code>
                </pre>
              </details>
            </section>
            <section
              aria-labelledby="assumptions-heading"
              className={`${panelClass} min-w-0`}
            >
              <h2 id="assumptions-heading" className="text-lg font-semibold">
                03 / Validate: review the logic
              </h2>
              <p className="mt-3 text-sm text-slate-600">
                {proposal.definition
                  ? "Calculation: sum paid invoice amounts in integer cents, grouped by UTC payment month."
                  : "No net revenue calculation has been invented. The following assumptions describe the supported collected-revenue fallback only."}
              </p>
              <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-slate-600">
                {proposal.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
              <h3 className="mt-5 text-sm font-semibold">Fixture evidence</h3>
              <ul className="mt-2 space-y-3 text-sm text-slate-600">
                {proposal.evidence.map((evidence) => (
                  <li key={evidence.reference.field} className="break-words">
                    <code>
                      {evidence.reference.dataset}.{evidence.reference.table}.
                      {evidence.reference.field}
                    </code>
                    : {evidence.explanation}
                  </li>
                ))}
              </ul>
              <p className="mt-5 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-500">
                Fictional Acme workspace · as of {demoAsOf}. Definition
                validation checks supported logic and references. It does not
                prove numerical correctness; deterministic calculation tests
                verify fixture results.
              </p>
            </section>
          </div>

          <section aria-labelledby="review-heading" className={panelClass}>
            <h2 id="review-heading" className="text-lg font-semibold">
              Review and approval
            </h2>
            {issues.length > 0 && (
              <ul
                aria-label="Definition validation issues"
                className="mt-3 list-disc pl-5 text-sm text-slate-600"
              >
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            {proposal.clarifications.map((question) => (
              <div
                key={question.id}
                className="mt-4 space-y-3 rounded-lg border border-slate-200 p-4 text-sm leading-6"
              >
                <p>
                  <strong>Required clarification:</strong> {question.question}
                </p>
                {question.answer ? (
                  <p>
                    Confirmed: use monthly collected revenue without customer
                    grouping.
                  </p>
                ) : (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={proposal.status !== "needs_clarification"}
                    onClick={() =>
                      act(() =>
                        setProposal(
                          resolveMetricClarification(
                            proposal,
                            "use-monthly-collected-revenue",
                          ),
                        ),
                      )
                    }
                  >
                    Use monthly collected revenue instead
                  </button>
                )}
              </div>
            ))}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className={buttonClass}
                disabled={proposal.status !== "draft"}
                onClick={() =>
                  act(() => setProposal(submitMetricProposal(proposal)))
                }
              >
                Submit for review
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={proposal.status !== "ready_for_review"}
                onClick={() =>
                  act(() =>
                    setProposal(
                      approveMetricProposal(proposal, {
                        reviewer: "local-demo-reviewer",
                      }),
                    ),
                  )
                }
              >
                Approve metric
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={proposal.status !== "approved" || isPublished}
                onClick={() =>
                  act(() => {
                    const published = publishMetricProposal(proposal);
                    setHistory([...history, published]);
                  })
                }
              >
                Publish approved version
              </button>
              {isPublished && latest && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() =>
                    act(() =>
                      setProposal(
                        reviseMetricVersion(
                          latest,
                          `demo-proposal-${latest.definition.version + 1}`,
                        ),
                      ),
                    )
                  }
                >
                  Create next version
                </button>
              )}
            </div>
            {canReject && (
              <div className="mt-5 flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="rejection-reason"
                    className="block text-sm font-medium"
                  >
                    Rejection reason
                  </label>
                  <input
                    id="rejection-reason"
                    value={rejectionReason}
                    onChange={(event) => setRejectionReason(event.target.value)}
                    maxLength={4000}
                    className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={!rejectionReason.trim()}
                  onClick={() =>
                    act(() =>
                      setProposal(
                        rejectMetricProposal(proposal, rejectionReason),
                      ),
                    )
                  }
                >
                  Reject proposal
                </button>
              </div>
            )}
            {proposal.rejectionReason && (
              <p className="mt-4 text-sm text-slate-600">
                Rejected: {proposal.rejectionReason}
              </p>
            )}
          </section>
        </>
      )}

      <section aria-labelledby="embed-heading" className={panelClass}>
        <h2 id="embed-heading" className="text-lg font-semibold">
          04 / Preview and embed the published metric
        </h2>
        {!latest || !result ? (
          <p className="mt-3 text-sm text-slate-600">
            Submit, review, approve, and publish a proposal to preview it here.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-600">
              Published definition v{latest.definition.version} · UTC.{" "}
              {history.length} immutable version
              {history.length === 1 ? "" : "s"} in this session. A new draft
              leaves this published preview unchanged.
            </p>
            <ul
              aria-label="Published versions"
              className="mt-3 space-y-2 text-sm text-slate-600"
            >
              {history.map((published) => (
                <li key={published.definition.version}>
                  v{published.definition.version} · {published.proposal.id} ·
                  approved by {published.proposal.review?.reviewer}
                </li>
              ))}
            </ul>
            <section
              aria-label="Example revenue dashboard"
              className="mt-8 space-y-8 rounded-lg border border-slate-200 p-5 sm:p-6"
            >
              <MetricKpi result={result} />
              <MetricChart result={result} />
            </section>
            <pre
              className="mt-5 overflow-auto rounded-lg bg-slate-950 p-5 text-xs leading-6 text-slate-200"
              tabIndex={0}
              aria-label="React embedding example"
            >
              <code>{embedCode}</code>
            </pre>
          </>
        )}
      </section>
    </div>
  );
}
