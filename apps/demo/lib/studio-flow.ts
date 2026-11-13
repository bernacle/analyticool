import {
  approveMetricProposal,
  generateMetricProposal,
  proposalExamples,
  publishMetricProposal,
  rejectMetricProposal,
  resolveMetricClarification,
  reviseMetricVersion,
  submitMetricProposal,
  type MetricProposal,
  type MonthlyRevenueResult,
  type PublishedMetricVersion,
} from "@analyticool/core";
import { getDemoMetric } from "./demo-metric";

/**
 * Studio flow: Describe → Clarify → Review → Embed over the existing
 * @analyticool/core proposal lifecycle. No new lifecycle states.
 *
 * `studioTransition` returns a new state and never mutates its input, but the
 * core lifecycle keeps process-local capabilities (a consumed snapshot cannot
 * be transitioned twice). Call it once per user event, never inside a React
 * reducer or state updater, which React may invoke twice.
 */
export type Stage = "describe" | "clarify" | "review" | "embed";
export const stages: readonly Stage[] = [
  "describe",
  "clarify",
  "review",
  "embed",
];

/** The single answer core accepts for the net-revenue scope question. */
export const collectedRevenueFallback = "use-monthly-collected-revenue";

/** Stated on every approval: there is no authenticated reviewer. */
export const localReviewer = "local-session (unauthenticated)";

export interface StudioState {
  readonly stage: Stage;
  readonly prompt: string;
  /** Working proposal; null until Describe succeeds. Never fabricated. */
  readonly proposal: MetricProposal | null;
  /** Versions published in this browser session only. Lost on reload. */
  readonly history: readonly PublishedMetricVersion[];
  readonly error: string | null;
  /** Polite status announcement for the most recent successful action. */
  readonly notice: string | null;
  readonly nextId: number;
}

export type StudioAction =
  | { type: "setPrompt"; prompt: string }
  | { type: "describe" }
  | { type: "clarify"; answer: string }
  | { type: "reject"; reason: string }
  | { type: "approve" }
  | { type: "publish" }
  | { type: "revise" }
  | { type: "goToReview" }
  | { type: "back" }
  | { type: "reset" };

export const initialStudioState: StudioState = {
  stage: "describe",
  prompt: "",
  proposal: null,
  history: [],
  error: null,
  notice: null,
  nextId: 1,
};

export const supportedPrompts = [
  proposalExamples.monthlyRevenue,
  proposalExamples.netRevenue,
] as const;

export const unsupportedPromptMessage = `Analyticool can't build that metric here. This Studio matches only two fixture questions exactly (case and a final period are ignored), and it never guesses a calculation. Try "${proposalExamples.monthlyRevenue}" or "${proposalExamples.netRevenue}"`;

class StudioError extends Error {}

function fail(message: string): never {
  throw new StudioError(message);
}

export function latestPublication(
  state: StudioState,
): PublishedMetricVersion | null {
  return state.history.at(-1) ?? null;
}

/** True when the working proposal is the one already published. */
export function isPublished(state: StudioState): boolean {
  const id = state.proposal?.id;
  return id !== undefined && state.history.some((p) => p.proposal.id === id);
}

/** A revision draft exists for the latest publication and is not published yet. */
export function hasPendingRevision(state: StudioState): boolean {
  return (
    state.proposal !== null && state.history.length > 0 && !isPublished(state)
  );
}

function apply(state: StudioState, action: StudioAction): StudioState {
  const { proposal } = state;
  const base = { ...state, error: null, notice: null };
  switch (action.type) {
    case "setPrompt":
      return { ...base, prompt: action.prompt };

    case "describe": {
      if (state.stage !== "describe" || proposal !== null)
        fail("A proposal already exists. Start over to describe a new one.");
      if (!state.prompt.trim())
        fail(
          "Describe a metric first, or choose one of the two example questions.",
        );
      let generated: MetricProposal;
      try {
        generated = generateMetricProposal(
          state.prompt,
          `studio-proposal-${state.nextId}`,
        );
      } catch {
        fail(unsupportedPromptMessage);
      }
      const submitted = submitMetricProposal(generated);
      return {
        ...base,
        proposal: submitted,
        nextId: state.nextId + 1,
        stage:
          submitted.status === "needs_clarification" ? "clarify" : "review",
      };
    }

    case "clarify": {
      if (state.stage !== "clarify" || !proposal)
        fail("There is no open clarification.");
      const resolved = resolveMetricClarification(proposal, action.answer);
      return {
        ...base,
        proposal: submitMetricProposal(resolved),
        stage: "review",
      };
    }

    case "reject": {
      if (!proposal) fail("There is no proposal to reject.");
      if (!action.reason.trim())
        fail("Give a reason before rejecting this proposal.");
      return {
        ...base,
        proposal: rejectMetricProposal(proposal, action.reason.trim()),
        notice: `Proposal v${proposal.metricVersion} rejected in this session.`,
      };
    }

    case "approve": {
      if (state.stage !== "review" || !proposal)
        fail("Only a proposal under review can be approved.");
      return {
        ...base,
        proposal: approveMetricProposal(proposal, { reviewer: localReviewer }),
        notice: `Approved v${proposal.metricVersion} locally in this browser session. Not saved and not a numerical verification.`,
      };
    }

    case "publish": {
      if (!proposal || proposal.status !== "approved")
        fail("Approve the proposal before adding it to your app.");
      if (isPublished(state))
        fail(`Version ${proposal.metricVersion} is already published.`);
      const publication = publishMetricProposal(proposal);
      return {
        ...base,
        history: [...state.history, publication],
        stage: "embed",
        notice: `Published v${publication.definition.version} in this session only. It is not persisted.`,
      };
    }

    case "revise": {
      const latest = latestPublication(state);
      if (!latest || !isPublished(state))
        fail("Only the latest published version can be revised.");
      const draft = reviseMetricVersion(
        latest,
        `studio-proposal-${state.nextId}`,
      );
      return {
        ...base,
        proposal: submitMetricProposal(draft),
        nextId: state.nextId + 1,
        stage: "review",
      };
    }

    case "goToReview":
      if (!proposal) fail("There is nothing to review yet.");
      return { ...base, stage: "review" };

    case "back":
      switch (state.stage) {
        case "describe":
          return base;
        case "clarify":
          // Core has no discard transition: the in-memory snapshot is dropped.
          return { ...base, proposal: null, stage: "describe" };
        case "review":
          if (state.history.length > 0) return { ...base, stage: "embed" };
          return { ...base, proposal: null, stage: "describe" };
        case "embed":
          return { ...base, stage: "review" };
      }
      return base;

    case "reset":
      return { ...initialStudioState, nextId: state.nextId };
  }
}

/**
 * Apply one user action. Any error leaves every field except `error`
 * unchanged, so a failed action never shows a partial or invented state.
 */
export function studioTransition(
  state: StudioState,
  action: StudioAction,
): StudioState {
  try {
    return apply(state, action);
  } catch (cause) {
    const message =
      cause instanceof StudioError
        ? cause.message
        : cause instanceof Error
          ? `The proposal lifecycle refused this action: ${cause.message}`
          : "The proposal lifecycle refused this action.";
    return { ...state, error: message, notice: null };
  }
}

/** Draft preview: a real core calculation, or null when no definition exists. */
export function previewResult(
  proposal: MetricProposal | null,
): MonthlyRevenueResult | null {
  if (!proposal?.definition) return null;
  return getDemoMetric({
    ...proposal.definition,
    version: proposal.metricVersion,
  });
}

/** Result for the latest published definition, exactly as an app would get it. */
export function publishedResult(
  state: StudioState,
): MonthlyRevenueResult | null {
  const latest = latestPublication(state);
  return latest ? getDemoMetric({ ...latest.definition }) : null;
}

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Exact to the cent for any safe-integer amount. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = BigInt(Math.abs(cents));
  return `${sign}${wholeDollars.format(abs / 100n)}.${String(abs % 100n).padStart(2, "0")}`;
}

export function formatMonth(month: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Hero figures derived from the result's points only. */
export function summarize(result: MonthlyRevenueResult) {
  const points = result.points;
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const first = points[0];
  if (!latest || !previous || !first)
    throw new Error("Monthly revenue must contain six points.");
  return {
    latest,
    previous,
    changeCents: latest.valueCents - previous.valueCents,
    firstMonth: first.month,
  };
}
