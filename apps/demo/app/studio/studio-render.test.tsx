import { readdirSync, readFileSync } from "node:fs";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { proposalExamples } from "@analyticool/core";
import { EMBED_SNIPPET } from "../../lib/embed-snippet";
import {
  initialStudioState,
  studioTransition,
  type StudioAction,
  type StudioState,
} from "../../lib/studio-flow";
import { ClarifyStep } from "./clarify-step";
import { EmbedStep } from "./embed-step";
import { RejectedPanel } from "./rejected-panel";
import { ReviewStep } from "./review-step";
import { Studio } from "./studio";

const noop = () => {};
const heading = () => createRef<HTMLHeadingElement>();

function run(...actions: StudioAction[]): StudioState {
  return actions.reduce(studioTransition, initialStudioState);
}
const monthly: StudioAction[] = [
  { type: "setPrompt", prompt: proposalExamples.monthlyRevenue },
  { type: "describe" },
];

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const review = (state: StudioState) =>
  text(
    renderToStaticMarkup(
      <ReviewStep state={state} dispatch={noop} headingRef={heading()} />,
    ),
  );

describe("Studio rendering", () => {
  it("starts on Describe with the local, synthetic limitations stated", () => {
    const html = text(renderToStaticMarkup(<Studio />));
    expect(html).toContain("What do you want to measure?");
    expect(html).toContain("Synthetic fixtures · local session");
    expect(html).toContain("no authenticated reviewer");
    expect(html).toContain("nothing is saved");
    expect(html).toContain("nothing controls a production tenant");
    expect(html).not.toMatch(/\$\d/);
  });

  it("labels the review figure as a draft preview until approved", () => {
    const html = review(run(...monthly));
    expect(html).toContain("$3,420.00");
    expect(html).toContain("Draft preview · synthetic fixtures · not approved");
    expect(html).toContain("Approve metric");
    expect(html).toContain("no authenticated reviewer");
    expect(html).toContain("it does not verify the numbers");
    expect(html).toContain("not a numerical verification");
    expect(html).not.toContain("Approved locally");
  });

  it("explains meaning, time basis, assumptions and only the actual evidence", () => {
    const html = review(run(...monthly));
    expect(html).toContain("Payment timestamp (paidAt), grouped by UTC");
    expect(html).toContain("six complete months before 2026-07-01");
    expect(html).toContain("This is collected revenue, not MRR");
    expect(html).toContain("synthetic-billing.invoices.amountCents");
    expect(html).toContain("calculateMonthlyRevenue");
    expect(html).toContain(
      "Nothing on this screen has been reconciled against Stripe",
    );
    // Payouts are mentioned only as not available; no ledger imagery.
    expect(html).toContain(
      "Proposed No payment processor connector, payout reconciliation",
    );
    expect(html).not.toMatch(
      /orphan|Stripe paid out|Stripe fees|Difference|reconciled with/i,
    );
  });

  it("states approval is local and not durable or a verification", () => {
    const html = review(run(...monthly, { type: "approve" }));
    expect(html).toContain(
      "Approved locally · synthetic fixtures · not published",
    );
    expect(html).toContain("Approved v1 locally in this browser session.");
    expect(html).toContain(
      "No authenticated reviewer, not saved, and not a numerical verification.",
    );
    expect(html).toContain("Add it to your app");
  });

  it("asks the core clarification and shows no figure before it is resolved", () => {
    const state = run(
      { type: "setPrompt", prompt: proposalExamples.netRevenue },
      { type: "describe" },
    );
    if (!state.proposal) throw new Error("expected a proposal");
    const html = text(
      renderToStaticMarkup(
        <ClarifyStep
          proposal={state.proposal}
          error={null}
          dispatch={noop}
          headingRef={heading()}
        />,
      ),
    );
    expect(html).toContain("What does net revenue subtract");
    expect(html).toContain("Use monthly collected revenue instead");
    expect(html).toContain("Reject this proposal");
    expect(html).not.toMatch(/\$\d/);
  });

  it("says a rejected reviewed draft was not published, and an unresolved one was not calculated", () => {
    const reason = { type: "reject", reason: "Not what we need." } as const;
    const render = (state: StudioState) => {
      if (!state.proposal) throw new Error("expected a proposal");
      return text(
        renderToStaticMarkup(
          <RejectedPanel
            proposal={state.proposal}
            state={state}
            dispatch={noop}
            headingRef={heading()}
          />,
        ),
      );
    };
    const reviewed = render(run(...monthly, reason));
    expect(reviewed).toContain(
      "Nothing was published from this proposal; its draft preview is discarded.",
    );
    expect(reviewed).not.toContain("Nothing was calculated");
    const unresolved = render(
      run(
        { type: "setPrompt", prompt: proposalExamples.netRevenue },
        { type: "describe" },
        reason,
      ),
    );
    expect(unresolved).toContain(
      "Nothing was calculated or published from this proposal.",
    );
  });

  it("embeds the published result with the real snippet and no hosted API sample", () => {
    const state = run(...monthly, { type: "approve" }, { type: "publish" });
    const markup = renderToStaticMarkup(
      <EmbedStep
        state={state}
        dispatch={noop}
        headingRef={heading()}
        announce={noop}
      />,
    );
    const html = text(markup);
    expect(html).toContain("Published v1 in this session · not persisted");
    expect(html).toContain("$3,420.00");
    expect(html).toContain("Copy code");
    const escaped = EMBED_SNIPPET.replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
    expect(markup).toContain(`<code>${escaped}</code>`);
    expect(html).toContain("is not available");
    expect(markup).not.toMatch(/&lt;Metric\s+id|token=/);
    expect(html).not.toMatch(/fully (CSS[- ])?themable/i);
    expect(html).toContain("not every style can be changed with CSS yet");
  });
});

it("hard-codes no currency figures in Studio components", () => {
  const dir = new URL("./", import.meta.url);
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
    .map((file) => readFileSync(new URL(file, dir), "utf8"));
  expect(sources.length).toBeGreaterThanOrEqual(6);
  for (const source of sources) expect(source).not.toMatch(/\$\s?\d/);
});
