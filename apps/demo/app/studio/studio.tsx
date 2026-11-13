"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialStudioState,
  stages,
  studioTransition,
  type Stage,
  type StudioAction,
  type StudioState,
} from "../../lib/studio-flow";
import { ClarifyStep } from "./clarify-step";
import { DescribeStep } from "./describe-step";
import { EmbedStep } from "./embed-step";
import { RejectedPanel } from "./rejected-panel";
import { ReviewStep } from "./review-step";

const stageLabels: Record<Stage, string> = {
  describe: "Describe",
  clarify: "Clarify",
  review: "Review",
  embed: "Embed",
};

export type Dispatch = (action: StudioAction) => void;

export function Studio() {
  const [state, setState] = useState<StudioState>(initialStudioState);
  // The latest committed state. Core lifecycle snapshots can be consumed only
  // once, so each event transitions from this ref, never from a stale render
  // and never inside a state updater that React may call twice.
  const latest = useRef(state);
  const [live, setLive] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef(state.stage);
  const previousStatus = useRef(state.proposal?.status);

  const dispatch = useCallback<Dispatch>((action) => {
    const next = studioTransition(latest.current, action);
    latest.current = next;
    setState(next);
    if (next.notice) setLive(next.notice);
  }, []);

  const status = state.proposal?.status;
  useEffect(() => {
    const statusChanged = previousStatus.current !== status;
    if (previousStage.current !== state.stage) heading.current?.focus();
    // Approval and rejection keep the stage but remove the focused control:
    // move focus to the next action, or to the rejection heading.
    else if (statusChanged && status === "approved")
      document.getElementById("publish-action")?.focus();
    else if (statusChanged && status === "rejected") heading.current?.focus();
    previousStage.current = state.stage;
    previousStatus.current = status;
  }, [state.stage, status]);

  const { stage, proposal } = state;
  // A rejected revision leaves the published versions reachable from Embed.
  const rejected = proposal?.status === "rejected" && stage !== "embed";

  return (
    <div data-display="sans" className="min-h-dvh">
      <header className="topbar">
        <span className="topbar__brand">Analyticool Studio</span>
        <ol aria-label="Creation stages" className="topbar__stages">
          {stages.map((item) => (
            <li key={item} aria-current={item === stage ? "step" : undefined}>
              {stageLabels[item]}
            </li>
          ))}
        </ol>
        <div className="topbar__meta">
          <span className="pill">Synthetic fixtures · local session</span>
          <span>Fictional Acme (synthetic)</span>
        </div>
      </header>

      <main className="canvas" data-stage={stage}>
        <p className="eyebrow">
          Step {stages.indexOf(stage) + 1} of 4 · {stageLabels[stage]}
        </p>
        {rejected ? (
          <RejectedPanel
            proposal={proposal}
            state={state}
            dispatch={dispatch}
            headingRef={heading}
          />
        ) : stage === "describe" ? (
          <DescribeStep
            state={state}
            dispatch={dispatch}
            headingRef={heading}
          />
        ) : stage === "clarify" && proposal ? (
          <ClarifyStep
            proposal={proposal}
            error={state.error}
            dispatch={dispatch}
            headingRef={heading}
          />
        ) : stage === "review" && proposal ? (
          <ReviewStep state={state} dispatch={dispatch} headingRef={heading} />
        ) : stage === "embed" ? (
          <EmbedStep
            state={state}
            dispatch={dispatch}
            headingRef={heading}
            announce={setLive}
          />
        ) : null}
      </main>

      <footer className="footer">
        A local prototype on synthetic fixtures. No AI request, database,
        connector or payment processor is involved. Approvals and versions live
        only in this browser tab: there is no authenticated reviewer, nothing is
        saved, and nothing controls a production tenant. Reload or Start over to
        clear the session.
      </footer>

      {/* The one polite live region: approved, published, rejected, copied. */}
      <p aria-live="polite" role="status" className="sr-only-live">
        {live}
      </p>
    </div>
  );
}
