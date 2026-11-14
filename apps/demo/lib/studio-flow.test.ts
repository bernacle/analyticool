import { describe, expect, it } from "vitest";
import { proposalExamples } from "@analyticool/core";
import {
  collectedRevenueFallback,
  formatCents,
  hasPendingRevision,
  initialStudioState,
  isPublished,
  localReviewer,
  previewResult,
  publishedResult,
  studioTransition,
  summarize,
  unsupportedPromptMessage,
  type StudioAction,
  type StudioState,
} from "./studio-flow";

const fixtureCents = [200_000, 225_000, 249_000, 275_000, 310_000, 342_000];

function run(state: StudioState, ...actions: StudioAction[]): StudioState {
  return actions.reduce(studioTransition, state);
}

function describeWith(prompt: string): StudioState {
  return run(
    initialStudioState,
    { type: "setPrompt", prompt },
    { type: "describe" },
  );
}

const monthly = () => describeWith(proposalExamples.monthlyRevenue);
const net = () => describeWith(proposalExamples.netRevenue);

function expectUnchangedExceptError(before: StudioState, after: StudioState) {
  expect(after.error).toBeTruthy();
  expect({ ...after, error: null, notice: null }).toEqual({
    ...before,
    error: null,
    notice: null,
  });
}

describe("Describe", () => {
  it("turns the supported monthly prompt into a proposal under review with real fixture figures", () => {
    const state = monthly();
    expect(state.error).toBeNull();
    expect(state.stage).toBe("review");
    expect(state.proposal?.status).toBe("ready_for_review");
    expect(state.proposal?.metricVersion).toBe(1);
    const result = previewResult(state.proposal);
    expect(result?.points.map((p) => p.valueCents)).toEqual(fixtureCents);
    expect(result?.metricVersion).toBe(1);
    expect(publishedResult(state)).toBeNull();
  });

  it.each([
    proposalExamples.monthlyRevenue.toUpperCase(),
    proposalExamples.monthlyRevenue.replace(/\.$/, ""),
    `  ${proposalExamples.monthlyRevenue}  `,
  ])("accepts the case/period/whitespace variant %j", (prompt) => {
    expect(describeWith(prompt).stage).toBe("review");
  });

  it.each([
    "Show MRR by plan.",
    "Show monthly revenue for the last twelve months.",
    "Show net revenue by customer and region.",
  ])("rejects the unsupported prompt %j without a proposal", (prompt) => {
    const state = describeWith(prompt);
    expect(state.error).toBe(unsupportedPromptMessage);
    expect(state.proposal).toBeNull();
    expect(state.stage).toBe("describe");
    expect(previewResult(state.proposal)).toBeNull();
  });

  it("asks for a description when the prompt is empty", () => {
    const state = describeWith("   ");
    expect(state.error).toMatch(/Describe a metric first/);
    expect(state.proposal).toBeNull();
    expect(state.stage).toBe("describe");
  });

  it("uses a fresh proposal id per attempt", () => {
    const first = monthly();
    const again = run(first, { type: "back" }, { type: "describe" });
    expect(again.proposal?.id).not.toBe(first.proposal?.id);
  });
});

describe("Clarify", () => {
  it("asks the core clarification for net revenue and computes nothing until it is resolved", () => {
    const state = net();
    expect(state.stage).toBe("clarify");
    expect(state.proposal?.status).toBe("needs_clarification");
    expect(state.proposal?.definition).toBeNull();
    // Core's own question text, which the UI shows verbatim.
    expect(state.proposal?.clarifications[0]?.question).toMatch(
      /^What does net revenue subtract .* or reject this proposal\.$/,
    );
    expect(previewResult(state.proposal)).toBeNull();
    expect(run(state, { type: "approve" }).proposal?.status).toBe(
      "needs_clarification",
    );
  });

  it("refuses an answer core does not support, without changing state", () => {
    const state = net();
    const after = run(state, { type: "clarify", answer: "subtract refunds" });
    expectUnchangedExceptError(state, after);
    expect(previewResult(after.proposal)).toBeNull();
  });

  it("moves to review only after the explicit collected-revenue fallback", () => {
    const state = run(net(), {
      type: "clarify",
      answer: collectedRevenueFallback,
    });
    expect(state.error).toBeNull();
    expect(state.stage).toBe("review");
    expect(state.proposal?.status).toBe("ready_for_review");
    expect(state.proposal?.definition?.name).toBe("Monthly collected revenue");
    expect(state.proposal?.assumptions.at(-1)).toMatch(
      /instead of net revenue by customer/,
    );
    expect(
      previewResult(state.proposal)?.points.map((p) => p.valueCents),
    ).toEqual(fixtureCents);
  });
});

describe("Back", () => {
  it("returns from clarify to describe and discards the proposal, keeping the prompt", () => {
    const state = run(net(), { type: "back" });
    expect(state.stage).toBe("describe");
    expect(state.proposal).toBeNull();
    expect(state.prompt).toBe(proposalExamples.netRevenue);
  });

  it("returns from review to describe and discards the unpublished proposal", () => {
    const resolved = run(net(), {
      type: "clarify",
      answer: collectedRevenueFallback,
    });
    for (const state of [monthly(), resolved]) {
      const back = run(state, { type: "back" });
      expect(back.stage).toBe("describe");
      expect(back.proposal).toBeNull();
    }
  });

  it("returns from embed to a read-only review of the published proposal and forward again", () => {
    const embed = run(monthly(), { type: "approve" }, { type: "publish" });
    const review = run(embed, { type: "back" });
    expect(review.stage).toBe("review");
    expect(isPublished(review)).toBe(true);
    expect(run(review, { type: "back" }).stage).toBe("embed");
  });
});

describe("Approve and reject", () => {
  it("approves with an explicitly unauthenticated local reviewer", () => {
    const state = run(monthly(), { type: "approve" });
    expect(state.proposal?.status).toBe("approved");
    expect(state.proposal?.review?.reviewer).toBe(localReviewer);
    expect(localReviewer).toMatch(/unauthenticated/);
    expect(state.notice).toMatch(/locally/);
    expect(state.notice).toMatch(/not a numerical verification/);
    expect(state.history).toHaveLength(0);
  });

  it("requires a non-empty rejection reason", () => {
    const state = monthly();
    const after = run(state, { type: "reject", reason: "  " });
    expectUnchangedExceptError(state, after);
    expect(after.proposal?.status).toBe("ready_for_review");
  });

  it.each([
    ["review", monthly],
    ["clarify", net],
  ] as const)(
    "rejects from %s; the rejected proposal can no longer be approved or published",
    (_, start) => {
      const rejected = run(start(), {
        type: "reject",
        reason: "We need net revenue by customer.",
      });
      expect(rejected.proposal?.status).toBe("rejected");
      expect(rejected.proposal?.rejectionReason).toBe(
        "We need net revenue by customer.",
      );
      const approve = run(rejected, { type: "approve" });
      expect(approve.error).toBeTruthy();
      expect(approve.proposal?.status).toBe("rejected");
      const publish = run(rejected, { type: "publish" });
      expect(publish.error).toBeTruthy();
      expect(publishedResult(publish)).toBeNull();
    },
  );
});

describe("Invalid or incomplete transitions surface as errors", () => {
  it("cannot approve before review, or publish before approval", () => {
    const fresh = run(initialStudioState, { type: "approve" });
    expectUnchangedExceptError(initialStudioState, fresh);
    const review = monthly();
    expectUnchangedExceptError(review, run(review, { type: "publish" }));
    expectUnchangedExceptError(
      initialStudioState,
      run(initialStudioState, { type: "clarify", answer: "x" }),
    );
    expectUnchangedExceptError(
      initialStudioState,
      run(initialStudioState, { type: "revise" }),
    );
  });

  it("cannot approve twice, publish twice or describe over an existing proposal", () => {
    const approved = run(monthly(), { type: "approve" });
    expectUnchangedExceptError(approved, run(approved, { type: "approve" }));
    const published = run(approved, { type: "publish" });
    const twice = run(published, { type: "publish" });
    expectUnchangedExceptError(published, twice);
    expect(twice.history).toHaveLength(1);
    const stale = { ...approved, stage: "describe" as const };
    expectUnchangedExceptError(stale, run(stale, { type: "describe" }));
  });

  it("clears a previous error on the next successful action", () => {
    const failed = describeWith("Show churn.");
    const fixed = run(
      failed,
      { type: "setPrompt", prompt: proposalExamples.monthlyRevenue },
      { type: "describe" },
    );
    expect(fixed.error).toBeNull();
    expect(fixed.stage).toBe("review");
  });
});

describe("Publish, embed and revise", () => {
  it("publishes v1 and the embed result matches the published definition version", () => {
    const state = run(monthly(), { type: "approve" }, { type: "publish" });
    expect(state.stage).toBe("embed");
    expect(state.history).toHaveLength(1);
    const latest = state.history[0];
    const result = publishedResult(state);
    expect(latest?.definition.version).toBe(1);
    expect(result?.metricVersion).toBe(1);
    expect(result?.points.map((p) => p.valueCents)).toEqual(fixtureCents);
    expect(state.notice).toMatch(/not persisted/);
  });

  it("revises to a v2 draft under review while v1 stays published and unchanged", () => {
    const v1 = run(monthly(), { type: "approve" }, { type: "publish" });
    const v1Result = publishedResult(v1);
    const v2 = run(v1, { type: "revise" });
    expect(v2.stage).toBe("review");
    expect(v2.proposal?.status).toBe("ready_for_review");
    expect(v2.proposal?.metricVersion).toBe(2);
    expect(v2.history).toEqual(v1.history);
    expect(publishedResult(v2)).toEqual(v1Result);
    expect(hasPendingRevision(v2)).toBe(true);
    expect(previewResult(v2.proposal)?.metricVersion).toBe(2);

    // Leaving the revision keeps it: core allows one successor per publication.
    const embed = run(v2, { type: "back" });
    expect(embed.stage).toBe("embed");
    expectUnchangedExceptError(embed, run(embed, { type: "revise" }));
    const resumed = run(embed, { type: "goToReview" });
    expect(resumed.proposal).toBe(v2.proposal);

    const published = run(resumed, { type: "approve" }, { type: "publish" });
    expect(published.history).toHaveLength(2);
    expect(published.history.map((p) => p.definition.version)).toEqual([1, 2]);
    expect(publishedResult(published)?.metricVersion).toBe(2);
    expect(hasPendingRevision(published)).toBe(false);
  });

  it("start over clears the local session", () => {
    const state = run(
      monthly(),
      { type: "approve" },
      { type: "publish" },
      { type: "reset" },
    );
    expect(state.history).toHaveLength(0);
    expect(state.proposal).toBeNull();
    expect(state.stage).toBe("describe");
  });
});

describe("Formatting derives from result points", () => {
  it("formats exact cents and summarizes the latest month", () => {
    expect(formatCents(342_000)).toBe("$3,420.00");
    expect(formatCents(-3_201)).toBe("−$32.01");
    expect(formatCents(Number.MAX_SAFE_INTEGER)).toBe("$90,071,992,547,409.91");
    const result = previewResult(monthly().proposal);
    if (!result) throw new Error("expected a result");
    const summary = summarize(result);
    expect(summary.latest).toEqual({ month: "2026-06", valueCents: 342_000 });
    expect(summary.changeCents).toBe(32_000);
    expect(summary.firstMonth).toBe("2026-01");
  });
});
