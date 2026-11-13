import type { RefObject } from "react";
import type { MetricProposal } from "@analyticool/core";
import type { StudioState } from "../../lib/studio-flow";
import type { Dispatch } from "./studio";

export function RejectedPanel({
  proposal,
  state,
  dispatch,
  headingRef,
}: {
  proposal: MetricProposal;
  state: StudioState;
  dispatch: Dispatch;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const published = state.history.length > 0;
  return (
    <section aria-labelledby="rejected-heading">
      <h1
        id="rejected-heading"
        ref={headingRef}
        tabIndex={-1}
        className="display"
      >
        Proposal rejected
      </h1>
      <div className="card stack-lg">
        <span className="status" data-tone="err">
          Rejected v{proposal.metricVersion} in this session
        </span>
        <p className="mt-3">Reason: {proposal.rejectionReason}</p>
        <p className="meta mt-2">
          Nothing was calculated or published from this proposal.
          {published
            ? " Earlier published versions stay unchanged. Core allows one revision per published version, so start over to try again."
            : " Start over to describe a new metric."}
        </p>
        <div className="actions mt-4">
          {published && (
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: "back" })}
            >
              Back to embed
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => dispatch({ type: "reset" })}
          >
            Start over
          </button>
        </div>
      </div>
    </section>
  );
}
