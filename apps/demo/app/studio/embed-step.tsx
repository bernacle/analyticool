import type { RefObject } from "react";
import { MetricChart, MetricKpi } from "@analyticool/react";
import { EMBED_SNIPPET } from "../../lib/embed-snippet";
import {
  hasPendingRevision,
  latestPublication,
  publishedResult,
  type StudioState,
} from "../../lib/studio-flow";
import { CopyButton } from "./copy-button";
import type { Dispatch } from "./studio";

export function EmbedStep({
  state,
  dispatch,
  headingRef,
  announce,
}: {
  state: StudioState;
  dispatch: Dispatch;
  headingRef: RefObject<HTMLHeadingElement | null>;
  announce: (message: string) => void;
}) {
  const latest = latestPublication(state);
  const result = publishedResult(state);
  if (!latest || !result) {
    return (
      <section aria-labelledby="embed-heading">
        <h1
          id="embed-heading"
          ref={headingRef}
          tabIndex={-1}
          className="display"
        >
          Nothing published yet
        </h1>
        <div role="alert" className="error-band">
          <strong>Not available.</strong> Approve and add a metric to your app
          before embedding it.
        </div>
      </section>
    );
  }
  const version = latest.definition.version;
  const successor = hasPendingRevision(state) ? state.proposal : null;
  const rejectedSuccessor = successor?.status === "rejected" ? successor : null;
  const pending = rejectedSuccessor ? null : successor;

  return (
    <section aria-labelledby="embed-heading">
      <h1 id="embed-heading" ref={headingRef} tabIndex={-1} className="display">
        Add it to your app
      </h1>
      <p className="lead">
        {latest.definition.name} v{version} is published in this browser session
        only. The preview renders the real{" "}
        <code className="inline">@analyticool/react</code> components with the
        result for that published definition.
      </p>

      <div className="stack-lg">
        <div className="hero__head">
          <h2 className="card-title">Preview</h2>
          <span className="status" data-tone="ok">
            Published v{version} in this session · not persisted
          </span>
        </div>
        <section
          aria-label="Embed preview"
          className="chart-host embed-preview"
          data-approved="true"
          style={{ marginTop: 16 }}
        >
          <MetricKpi result={result} />
          <MetricChart result={result} />
        </section>
        <p className="meta mt-3">
          Synthetic fixtures · result v{result.metricVersion} · as of{" "}
          {result.asOf}. The preview sets the documented{" "}
          <code className="inline">--ac-*</code> CSS variables on its container
          (BRU-485 prototype contract); the package ships no stylesheet, and
          some part typography is inline, so not every style can be changed with
          CSS yet.
        </p>
      </div>

      <div className="card">
        <h2 className="card-title">Versions in this session</h2>
        <ul aria-label="Published versions" className="rows mt-2">
          {state.history.map((publication) => (
            <li
              key={publication.definition.version}
              className="meta"
              style={{
                padding: "12px 0",
                borderTop: "1px solid var(--line-1)",
              }}
            >
              <span className="text-ink">
                v{publication.definition.version}
              </span>{" "}
              · {publication.proposal.id} · approved by{" "}
              {publication.proposal.review?.reviewer}
            </li>
          ))}
        </ul>
        <div className="actions mt-3">
          {rejectedSuccessor ? (
            <span className="meta">
              v{rejectedSuccessor.metricVersion} was rejected. Core allows one
              revision per published version.
            </span>
          ) : pending ? (
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: "goToReview" })}
            >
              Return to v{pending.metricVersion} review
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: "revise" })}
            >
              Create next version
            </button>
          )}
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => dispatch({ type: "back" })}
          >
            Back to review
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => dispatch({ type: "reset" })}
          >
            Start over
          </button>
        </div>
        {state.error && (
          <div role="alert" className="error-band">
            <strong>Not done.</strong> {state.error}
          </div>
        )}
      </div>

      <div className="stack-lg">
        <div className="hero__head">
          <h2 className="card-title">React code</h2>
          <span className="tag tag--today">Available today</span>
        </div>
        <p className="lead" style={{ fontSize: 14, lineHeight: "20px" }}>
          <code className="inline">MetricKpi</code> and{" "}
          <code className="inline">MetricChart</code> take a validated{" "}
          <code className="inline">MonthlyRevenueResult</code> and never fetch.
          The packages are private workspace packages in this repository, not
          published to npm.
        </p>
        <div className="code">
          <div className="code__bar">
            <span className="meta">revenue-dashboard.tsx</span>
            <CopyButton text={EMBED_SNIPPET} announce={announce} />
          </div>
          <pre tabIndex={0} aria-label="React embedding example">
            <code>{EMBED_SNIPPET}</code>
          </pre>
        </div>
        <p className="meta mt-3">
          <span className="tag tag--proposed">Proposed</span> A hosted{" "}
          <code className="inline">&lt;Metric&gt;</code> component that fetches
          an approved definition is not available: there is no hosted API,
          token, key or origin control.
        </p>
      </div>
    </section>
  );
}
