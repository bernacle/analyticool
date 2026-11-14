import { useState, type RefObject } from "react";
import {
  validateProposalDefinition,
  type MetricProposal,
  type MonthlyRevenueResult,
} from "@analyticool/core";
import { MetricChart } from "@analyticool/react";
import {
  formatCents,
  formatMonth,
  isPublished,
  previewResult,
  summarize,
  type StudioState,
} from "../../lib/studio-flow";
import type { Dispatch } from "./studio";

type Phase = "review" | "approved" | "published";

const statusCopy: Record<Phase, { tone: string; word: string; tag: string }> = {
  review: {
    tone: "draft",
    word: "Draft · awaiting local review",
    tag: "Draft preview · synthetic fixtures · not approved",
  },
  approved: {
    tone: "ok",
    word: "Approved locally",
    tag: "Approved locally · synthetic fixtures · not published",
  },
  published: {
    tone: "ok",
    word: "Published in this session",
    tag: "Published in this session · synthetic fixtures · not persisted",
  },
};

export function ReviewStep({
  state,
  dispatch,
  headingRef,
}: {
  state: StudioState;
  dispatch: Dispatch;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const proposal = state.proposal;
  const result = previewResult(proposal);
  if (!proposal || !result) {
    // Unreachable through the flow: review needs a resolved definition.
    return (
      <section aria-labelledby="review-heading">
        <h1
          id="review-heading"
          ref={headingRef}
          tabIndex={-1}
          className="display"
        >
          Nothing to review
        </h1>
        <div role="alert" className="error-band">
          <strong>Incomplete proposal.</strong> No supported definition exists,
          so no figure is shown.
        </div>
      </section>
    );
  }
  const phase: Phase = isPublished(state)
    ? "published"
    : proposal.status === "approved"
      ? "approved"
      : "review";
  const status = statusCopy[phase];
  const summary = summarize(result);

  return (
    <section aria-labelledby="review-heading">
      <h1
        id="review-heading"
        ref={headingRef}
        tabIndex={-1}
        className="display"
      >
        {proposal.definition?.name} · v{proposal.metricVersion}
      </h1>
      <p className="lead">
        Is this number right, and should it be approved? The figure and chart
        below are calculated by{" "}
        <code className="inline">@analyticool/core</code> from synthetic
        fixtures for a fictional workspace.
      </p>

      <div className="card stack-lg" aria-labelledby="hero-label">
        <div className="hero__head">
          <span id="hero-label" className="meta">
            {formatMonth(summary.latest.month)} collected revenue
          </span>
          <span className="status" data-tone={status.tone}>
            {status.word}
          </span>
        </div>
        <p className="hero__figure" data-testid="hero-figure">
          {formatCents(summary.latest.valueCents)}
        </p>
        <p className="meta mt-1">
          {summary.changeCents >= 0 ? "+" : ""}
          {formatCents(summary.changeCents)} vs{" "}
          {formatMonth(summary.previous.month)} · six complete UTC months,{" "}
          {formatMonth(summary.firstMonth)} to{" "}
          {formatMonth(summary.latest.month)} · as of {result.asOf}
        </p>
        <p className="mt-3">
          <span className="tag">{status.tag}</span>
        </p>
        <div className="chart-host" data-approved={phase !== "review"}>
          <MetricChart result={result} />
        </div>
      </div>

      <DecisionBand
        key={proposal.id}
        phase={phase}
        proposal={proposal}
        dispatch={dispatch}
        error={state.error}
        hasHistory={state.history.length > 0}
      />

      <HowItsCalculated proposal={proposal} result={result} />
    </section>
  );
}

function DecisionBand({
  phase,
  proposal,
  dispatch,
  error,
  hasHistory,
}: {
  phase: Phase;
  proposal: MetricProposal;
  dispatch: Dispatch;
  error: string | null;
  hasHistory: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const backLabel = hasHistory ? "Back to embed" : "Back";

  return (
    <div className="card" role="group" aria-labelledby="decision-heading">
      <div className="decision">
        <div>
          <span
            className="status"
            data-tone={phase === "review" ? "draft" : "ok"}
          >
            <strong id="decision-heading" className="text-ink">
              {phase === "review"
                ? `Approve v${proposal.metricVersion} if this definition matches what you meant.`
                : phase === "approved"
                  ? `Approved v${proposal.metricVersion} locally in this browser session.`
                  : `v${proposal.metricVersion} is published in this session.`}
            </strong>
          </span>
          <p className="decision__why">
            {phase === "review"
              ? "Approval here is local: there is no authenticated reviewer, nothing is saved, and it controls no production tenant. Approving accepts the definition; it does not verify the numbers."
              : phase === "approved"
                ? "No authenticated reviewer, not saved, and not a numerical verification. Adding it to your app publishes this version in this tab only."
                : "Read-only. Published versions are immutable in this session and are lost on reload."}
          </p>
        </div>
        <div className="actions">
          {phase === "review" && (
            <>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => dispatch({ type: "approve" })}
              >
                Approve metric
              </button>
              <button
                type="button"
                className="btn"
                aria-expanded={rejecting}
                aria-controls="reject-panel"
                onClick={() => setRejecting(!rejecting)}
              >
                Reject…
              </button>
            </>
          )}
          {phase === "approved" && (
            <button
              id="publish-action"
              type="button"
              className="btn btn--primary"
              onClick={() => dispatch({ type: "publish" })}
            >
              Add it to your app
            </button>
          )}
          <button
            type="button"
            className={
              phase === "published" ? "btn btn--primary" : "btn btn--quiet"
            }
            onClick={() => dispatch({ type: "back" })}
          >
            {backLabel}
          </button>
        </div>
      </div>
      {phase !== "published" && (
        <p className="meta mt-3">
          {hasHistory
            ? `The v${proposal.metricVersion} draft stays open in this session; you can return to it from Embed.`
            : "Back discards this local proposal; nothing was saved."}
        </p>
      )}

      {phase === "review" && rejecting && (
        <form
          id="reject-panel"
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            dispatch({ type: "reject", reason });
          }}
        >
          <label htmlFor="review-reject-reason" className="field-label">
            Rejection reason
          </label>
          <input
            id="review-reject-reason"
            className="field"
            value={reason}
            maxLength={4000}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="actions mt-3">
            <button type="submit" className="btn">
              Reject proposal
            </button>
          </div>
        </form>
      )}

      {error && (
        <div role="alert" className="error-band">
          <strong>Not done.</strong> {error}
        </div>
      )}
    </div>
  );
}

function HowItsCalculated({
  proposal,
  result,
}: {
  proposal: MetricProposal;
  result: MonthlyRevenueResult;
}) {
  const definition = proposal.definition;
  const issues = validateProposalDefinition(proposal);
  const answered = proposal.clarifications.find((q) => q.answer !== null);
  const first = result.points[0];
  const last = result.points.at(-1);

  return (
    <section className="card" aria-labelledby="how-heading">
      <h2 id="how-heading" className="card-title">
        How it’s calculated
      </h2>
      <p className="meta mt-1">
        Everything below comes from this proposal and the core calculation. Tags
        say what exists in this repository today.
      </p>
      <div className="mt-3">
        <details className="disclosure" open>
          <summary>Meaning and time basis</summary>
          <div className="disclosure__body">
            <dl className="rows">
              <div>
                <dt>Meaning</dt>
                <dd>
                  Sum of paid USD invoices (collected revenue). Not MRR, not net
                  revenue, not recognised revenue.
                </dd>
              </div>
              <div>
                <dt>Time basis</dt>
                <dd>
                  Payment timestamp (paidAt), grouped by UTC calendar month
                </dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>
                  {first && last
                    ? `${formatMonth(first.month)} to ${formatMonth(last.month)}`
                    : ""}{" "}
                  · six complete months before {result.asOf}; the current
                  partial month is excluded
                </dd>
              </div>
              <div>
                <dt>Calculation</dt>
                <dd>
                  <code className="inline">{definition?.calculation}</code>
                </dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>
                  v{proposal.metricVersion} · proposal{" "}
                  <code className="inline">{proposal.id}</code>
                </dd>
              </div>
              <div>
                <dt>You asked</dt>
                <dd>“{proposal.originalRequest}”</dd>
              </div>
              {answered && (
                <div>
                  <dt>Your clarification</dt>
                  <dd>
                    Use monthly collected revenue instead of net revenue by
                    customer (no customer grouping)
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </details>

        <details className="disclosure">
          <summary>Assumptions ({proposal.assumptions.length})</summary>
          <div className="disclosure__body">
            <ul className="bullets">
              {proposal.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        </details>

        <details className="disclosure">
          <summary>Available evidence</summary>
          <div className="disclosure__body">
            <p>
              <span className="tag tag--today">In this repo</span> Fixture field
              metadata from the proposal, and a deterministic calculation by{" "}
              <code className="inline">calculateMonthlyRevenue</code> over
              synthetic invoices for the fictional Acme workspace.
            </p>
            <ul className="bullets mt-3">
              {proposal.evidence.map((evidence) => (
                <li key={evidence.reference.field}>
                  <code className="inline">
                    {evidence.reference.dataset}.{evidence.reference.table}.
                    {evidence.reference.field}
                  </code>
                  : {evidence.explanation}
                </li>
              ))}
            </ul>
          </div>
        </details>

        <details className="disclosure">
          <summary>Checks</summary>
          <div className="disclosure__body">
            {issues.length === 0 ? (
              <p>
                <span className="status" data-tone="ok">
                  Structural check passed
                </span>{" "}
                Field bindings and evidence references point at known{" "}
                <code className="inline">synthetic-billing.invoices</code>{" "}
                fields.
              </p>
            ) : (
              <ul className="bullets" aria-label="Definition validation issues">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <p className="mt-3">
              This check validates supported logic and references. It is not a
              numerical verification. Deterministic unit tests in{" "}
              <code className="inline">packages/core</code> check the fixture
              results.
            </p>
          </div>
        </details>

        <details className="disclosure">
          <summary>Not available here</summary>
          <div className="disclosure__body">
            <p>
              <span className="tag tag--proposed">Proposed</span> No payment
              processor connector, payout reconciliation, refund matching, SQL
              or live data. Nothing on this screen has been reconciled against
              Stripe or any real account.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
