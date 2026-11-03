import { z } from "zod";
import {
  monthlyRevenueDefinition,
  monthlyRevenueDefinitionSchema,
  versionedMonthlyRevenueDefinitionSchema,
} from "./monthly-revenue";

const text = z.string().trim().min(1).max(4_000);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const fieldReferenceSchema = z.strictObject({
  dataset: text,
  table: text,
  field: text,
});

/** Trusted synthetic metadata, not a schema supplied by a generator. */
export const fixtureCatalog = Object.freeze({
  dataset: "synthetic-billing",
  table: "invoices",
  fields: Object.freeze({
    id: "Unique invoice identifier",
    amountCents: "Full invoice amount in integer cents",
    currency: "USD only",
    status: "paid, open, void, or refunded",
    paidAt: "Payment instant with UTC offset; null for open/void invoices",
  }),
});

const bindingsSchema = z.strictObject({
  amountCents: fieldReferenceSchema,
  currency: fieldReferenceSchema,
  status: fieldReferenceSchema,
  paidAt: fieldReferenceSchema,
});

export const clarificationQuestion =
  "What does net revenue subtract (refunds, discounts, taxes or fees), and which customer key should be used? These fixtures cannot calculate net revenue by customer. You may explicitly use monthly collected revenue instead, without customer grouping, or reject this proposal.";

const contentSchema = z.strictObject({
  originalRequest: text,
  // This calculation identifier specifies SUM, paid-only filtering, and payment-month grouping.
  // No second expression language or executable strings are introduced.
  definition: monthlyRevenueDefinitionSchema.omit({ version: true }).nullable(),
  bindings: bindingsSchema,
  // Deliberately single-table: no join mappings or implicit relationships are supported.
  relationships: z.tuple([]),
  assumptions: z.array(text).min(1).max(30),
  clarifications: z
    .array(
      z.strictObject({
        id: z.literal("net-revenue-scope"),
        question: z.literal(clarificationQuestion),
        required: z.literal(true),
        answer: z.literal("use-monthly-collected-revenue").nullable(),
      }),
    )
    .max(1),
  evidence: z
    .array(
      z.strictObject({
        reference: fieldReferenceSchema,
        explanation: text,
      }),
    )
    .min(1)
    .max(30),
});

const reviewSchema = z.strictObject({ reviewer: text });
export const metricProposalSchema = contentSchema
  .extend({
    schemaVersion: z.literal(1),
    id: text,
    metricVersion: version,
    status: z.enum([
      "draft",
      "needs_clarification",
      "ready_for_review",
      "approved",
      "rejected",
    ]),
    review: reviewSchema.nullable(),
    rejectionReason: text.nullable(),
  })
  .superRefine((proposal, ctx) => {
    const unresolved = proposal.clarifications.some(
      (q) => q.required && q.answer === null,
    );
    if (proposal.status === "needs_clarification" && !unresolved) {
      ctx.addIssue({
        code: "custom",
        message:
          "Clarification state requires an unanswered required question.",
      });
    }
    if (
      (proposal.status === "ready_for_review" ||
        proposal.status === "approved") &&
      (unresolved || proposal.definition === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Review requires a definition and resolved required clarifications.",
      });
    }
    if ((proposal.status === "approved") !== (proposal.review !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "Only approved proposals have an approval review.",
      });
    }
    if (
      (proposal.status === "rejected") !==
      (proposal.rejectionReason !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Only rejected proposals have a rejection reason.",
      });
    }
  });

type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type MetricProposal = DeepReadonly<z.infer<typeof metricProposalSchema>>;
export const publishedMetricVersionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    proposal: metricProposalSchema.refine(
      (p) => p.status === "approved",
      "Publication requires approval.",
    ),
    definition: versionedMonthlyRevenueDefinitionSchema,
  })
  .superRefine((publication, ctx) => {
    const expected = versionedMonthlyRevenueDefinitionSchema.safeParse({
      ...publication.proposal.definition,
      version: publication.proposal.metricVersion,
    });
    if (
      !expected.success ||
      JSON.stringify(publication.definition) !== JSON.stringify(expected.data)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Published definition must match the reviewed proposal and version.",
      });
    }
  });
export type PublishedMetricVersion = DeepReadonly<
  z.infer<typeof publishedMetricVersionSchema>
>;

function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

// Parsing untrusted JSON never grants approval. These process-local capabilities
// also prevent callers from changing a status field or replaying an old snapshot.
const active = new WeakSet<MetricProposal>();
const publications = new WeakSet<PublishedMetricVersion>();
const publishedByProposal = new WeakMap<
  MetricProposal,
  PublishedMetricVersion
>();
const revisionStarted = new WeakSet<PublishedMetricVersion>();

function issue(input: unknown): MetricProposal {
  const proposal = freeze(metricProposalSchema.parse(input));
  active.add(proposal);
  return proposal;
}

function requireState(
  proposal: MetricProposal,
  states: readonly MetricProposal["status"][],
) {
  if (!active.has(proposal) || !states.includes(proposal.status)) {
    throw new Error(
      `Invalid proposal transition from ${proposal.status}; use an active lifecycle snapshot.`,
    );
  }
}

function transition(
  proposal: MetricProposal,
  changes: Record<string, unknown>,
): MetricProposal {
  const next = issue({ ...proposal, ...changes });
  active.delete(proposal);
  return next;
}

/** Trust boundary: accepts only new drafts, never imported approvals or later versions. */
export function createMetricProposal(input: unknown): MetricProposal {
  const parsed = metricProposalSchema.parse(input);
  if (parsed.status !== "draft" || parsed.metricVersion !== 1) {
    throw new Error("New proposals must start as draft version 1.");
  }
  return issue(parsed);
}

function knownReference(
  reference: z.infer<typeof fieldReferenceSchema>,
): boolean {
  return (
    reference.dataset === fixtureCatalog.dataset &&
    reference.table === fixtureCatalog.table &&
    Object.hasOwn(fixtureCatalog.fields, reference.field)
  );
}

/** Structural/semantic checks only. This is not verification of numerical results. */
export function validateProposalDefinition(input: unknown): readonly string[] {
  const parsed = metricProposalSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => issue.message);
  const proposal = parsed.data;
  const issues: string[] = [];
  if (proposal.definition === null)
    issues.push("A supported metric definition is required.");
  for (const [role, reference] of Object.entries(proposal.bindings)) {
    if (!knownReference(reference))
      issues.push(`Unknown source or field for ${role}.`);
    else if (reference.field !== role)
      issues.push(`Field ${reference.field} cannot be used as ${role}.`);
  }
  for (const evidence of proposal.evidence) {
    if (!knownReference(evidence.reference))
      issues.push("Unknown evidence reference.");
  }
  return issues;
}

export function submitMetricProposal(proposal: MetricProposal): MetricProposal {
  requireState(proposal, ["draft"]);
  if (proposal.clarifications.some((q) => q.required && q.answer === null)) {
    return transition(proposal, { status: "needs_clarification" });
  }
  const issues = validateProposalDefinition(proposal);
  if (issues.length) throw new Error(issues.join(" "));
  return transition(proposal, { status: "ready_for_review" });
}

/** A specific, explicit scope decision; arbitrary text cannot invent net-revenue logic. */
export function resolveMetricClarification(
  proposal: MetricProposal,
  answer: unknown,
): MetricProposal {
  requireState(proposal, ["needs_clarification"]);
  z.literal("use-monthly-collected-revenue").parse(answer);
  const question = proposal.clarifications.find(
    (q) => q.id === "net-revenue-scope" && q.answer === null,
  );
  if (!question) throw new Error("No unresolved scope clarification.");
  const definition = monthlyRevenueDefinitionSchema
    .omit({ version: true })
    .parse(
      Object.fromEntries(
        Object.entries(monthlyRevenueDefinition).filter(
          ([key]) => key !== "version",
        ),
      ),
    );
  return transition(proposal, {
    status: "draft",
    definition,
    clarifications: proposal.clarifications.map((q) => ({ ...q, answer })),
    assumptions: [
      ...proposal.assumptions,
      "Reviewer explicitly accepted monthly collected revenue instead of net revenue by customer; no customer grouping is performed.",
    ],
  });
}

/** Edits invalidate readiness and must pass submission/review again. */
export function editMetricProposal(
  proposal: MetricProposal,
  content: unknown,
): MetricProposal {
  requireState(proposal, ["draft", "needs_clarification", "ready_for_review"]);
  return transition(proposal, {
    ...contentSchema.parse(content),
    status: "draft",
  });
}

export function approveMetricProposal(
  proposal: MetricProposal,
  review: unknown,
): MetricProposal {
  requireState(proposal, ["ready_for_review"]);
  const issues = validateProposalDefinition(proposal);
  if (issues.length) throw new Error(issues.join(" "));
  return transition(proposal, {
    status: "approved",
    review: reviewSchema.parse(review),
  });
}

export function rejectMetricProposal(
  proposal: MetricProposal,
  reason: unknown,
): MetricProposal {
  requireState(proposal, ["draft", "needs_clarification", "ready_for_review"]);
  return transition(proposal, {
    status: "rejected",
    rejectionReason: text.parse(reason),
  });
}

export function publishMetricProposal(
  proposal: MetricProposal,
): PublishedMetricVersion {
  const existing = publishedByProposal.get(proposal);
  if (existing) return existing;
  requireState(proposal, ["approved"]);
  const publication = freeze(
    publishedMetricVersionSchema.parse({
      schemaVersion: 1,
      proposal,
      definition: { ...proposal.definition, version: proposal.metricVersion },
    }),
  );
  publications.add(publication);
  publishedByProposal.set(proposal, publication);
  active.delete(proposal);
  return publication;
}

/** Linear in-memory revisions; the previous publication always remains untouched. */
export function reviseMetricVersion(
  publication: PublishedMetricVersion,
  proposalId: unknown,
): MetricProposal {
  if (!publications.has(publication) || revisionStarted.has(publication)) {
    throw new Error(
      "Revision requires a published version without an existing successor.",
    );
  }
  const next = issue({
    ...publication.proposal,
    id: text.parse(proposalId),
    metricVersion: publication.definition.version + 1,
    status: "draft",
    review: null,
    rejectionReason: null,
  });
  if (next.id === publication.proposal.id) {
    active.delete(next);
    throw new Error("A revision requires a new proposal identifier.");
  }
  revisionStarted.add(publication);
  return next;
}
