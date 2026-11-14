import type { RefObject } from "react";
import { supportedPrompts, type StudioState } from "../../lib/studio-flow";
import type { Dispatch } from "./studio";

export function DescribeStep({
  state,
  dispatch,
  headingRef,
}: {
  state: StudioState;
  dispatch: Dispatch;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <section aria-labelledby="describe-heading">
      <h1
        id="describe-heading"
        ref={headingRef}
        tabIndex={-1}
        className="display"
      >
        What do you want to measure?
      </h1>
      <p className="lead">
        Describe a metric over the synthetic billing fixtures. This Studio has
        no AI: it matches your text exactly against two supported fixture
        questions and refuses anything else rather than guess a calculation.
      </p>

      <form
        className="stack-lg"
        onSubmit={(event) => {
          event.preventDefault();
          dispatch({ type: "describe" });
        }}
      >
        <div className="composer">
          <label htmlFor="metric-prompt" className="meta">
            Metric description
          </label>
          <textarea
            id="metric-prompt"
            value={state.prompt}
            maxLength={4000}
            placeholder="For example: Show monthly revenue for the last six months."
            aria-describedby={state.error ? "describe-error" : undefined}
            aria-invalid={state.error ? true : undefined}
            onChange={(event) =>
              dispatch({ type: "setPrompt", prompt: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                dispatch({ type: "describe" });
              }
            }}
          />
          <div className="composer__bar">
            <span className="meta">
              Synthetic fixtures · nothing leaves this tab
            </span>
            <button type="submit" className="btn btn--primary">
              Continue
            </button>
          </div>
        </div>
      </form>

      {state.error && (
        <div id="describe-error" role="alert" className="error-band">
          <strong>Not supported.</strong> {state.error}
        </div>
      )}

      <div className="stack-lg">
        <h2 className="card-title">Supported questions</h2>
        <p className="meta mt-1">Choose one to fill the description.</p>
        <div className="chips">
          {supportedPrompts.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              onClick={() => {
                dispatch({ type: "setPrompt", prompt: example });
                document.getElementById("metric-prompt")?.focus();
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
