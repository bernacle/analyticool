import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { MetricProposal } from "@analyticool/core";
import { collectedRevenueFallback } from "../../lib/studio-flow";
import type { Dispatch } from "./studio";

type Choice = "fallback" | "reject";

const options: ReadonlyArray<{
  value: Choice;
  label: string;
  hint: string;
  tag?: string;
}> = [
  {
    value: "fallback",
    label: "Use monthly collected revenue instead",
    hint: "Paid invoices summed by UTC payment month. No customer grouping, and nothing is subtracted.",
    tag: "Only supported calculation",
  },
  {
    value: "reject",
    label: "Reject this proposal",
    hint: "Net revenue by customer is what you need. Nothing is calculated.",
  },
];

export function ClarifyStep({
  proposal,
  error,
  dispatch,
  headingRef,
}: {
  proposal: MetricProposal;
  error: string | null;
  dispatch: Dispatch;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState("");
  const radios = useRef<Array<HTMLButtonElement | null>>([]);
  const question = proposal.clarifications.find((q) => q.answer === null);
  // Roving tabindex: the checked option, or the first one when none is checked.
  const focusable = choice ?? "fallback";

  function select(index: number) {
    const option = options[(index + options.length) % options.length];
    if (!option) return;
    setChoice(option.value);
    radios.current[options.indexOf(option)]?.focus();
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      select(index + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      select(index - 1);
    } else if (event.key === "1" || event.key === "2") {
      event.preventDefault();
      select(Number(event.key) - 1);
    } else if (event.key === " ") {
      event.preventDefault();
      select(index);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (choice) submit();
      else select(index);
    }
  }

  function submit() {
    if (choice === "fallback")
      dispatch({ type: "clarify", answer: collectedRevenueFallback });
    else if (choice === "reject") dispatch({ type: "reject", reason });
  }

  return (
    <section aria-labelledby="clarify-heading">
      <h1
        id="clarify-heading"
        ref={headingRef}
        tabIndex={-1}
        className="display"
      >
        Which of these did you mean?
      </h1>
      <p className="lead">
        You asked: “{proposal.originalRequest}”. Net revenue by customer cannot
        be calculated from these fixtures: they have no customer key and no
        refund, discount, tax or fee amounts. The question below is the
        lifecycle’s own clarification, shown verbatim.
      </p>
      {question && (
        <blockquote className="card" style={{ margin: "36px 0 0" }}>
          <p className="meta">Clarification required</p>
          <p className="mt-2" style={{ fontSize: 16, lineHeight: "24px" }}>
            {question.question}
          </p>
        </blockquote>
      )}

      <div
        role="radiogroup"
        aria-labelledby="clarify-heading"
        className="options"
        style={{ marginTop: 16 }}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(node) => {
              radios.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={choice === option.value}
            tabIndex={focusable === option.value ? 0 : -1}
            className="option"
            onClick={() => setChoice(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="option__dot" aria-hidden="true" />
            <span>
              {option.label}
              {option.tag && (
                <>
                  {" "}
                  <span className="option__tag">· {option.tag}</span>
                </>
              )}
              <span className="option__hint">{option.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {choice === "reject" && (
        <div className="card">
          <label htmlFor="clarify-reject-reason" className="field-label">
            Rejection reason
          </label>
          <input
            id="clarify-reject-reason"
            className="field"
            value={reason}
            maxLength={4000}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      )}

      {error && (
        <div role="alert" className="error-band">
          <strong>Not done.</strong> {error}
        </div>
      )}

      <div className="actions" style={{ marginTop: 24 }}>
        <button
          type="button"
          className="btn btn--primary"
          aria-disabled={choice === null}
          title={choice === null ? "Choose an option first" : undefined}
          onClick={() => {
            if (choice !== null) submit();
          }}
        >
          {choice === "reject" ? "Reject proposal" : "Continue"}
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => dispatch({ type: "back" })}
        >
          Back
        </button>
        <span className="meta">
          Back discards this local proposal; nothing was saved.
        </span>
      </div>
    </section>
  );
}
