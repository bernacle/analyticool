import { describe, expect, it } from "vitest";
import {
  approveMetricProposal,
  calculateMonthlyRevenue,
  createMetricProposal,
  editMetricProposal,
  generateMetricProposal,
  metricProposalSchema,
  monthlyRevenueDefinition,
  monthlyRevenueDefinitionSchema,
  proposalExamples,
  publishedMetricVersionSchema,
  publishMetricProposal,
  rejectMetricProposal,
  resolveMetricClarification,
  reviseMetricVersion,
  submitMetricProposal,
  validateProposalDefinition,
  type MetricProposal,
} from "./index";

const draft = () =>
  generateMetricProposal(proposalExamples.monthlyRevenue, "proposal-1");
const ambiguous = () =>
  generateMetricProposal(proposalExamples.netRevenue, "proposal-net");
const review = { reviewer: "local-reviewer" };
const approve = (proposal = draft()) =>
  approveMetricProposal(submitMetricProposal(proposal), review);
const content = (proposal: MetricProposal) => ({
  originalRequest: proposal.originalRequest,
  definition: proposal.definition,
  bindings: proposal.bindings,
  relationships: proposal.relationships,
  assumptions: proposal.assumptions,
  clarifications: proposal.clarifications,
  evidence: proposal.evidence,
});

describe("untrusted metric proposal contract", () => {
  it("generates a deterministic draft resolved to trusted fixture fields", () => {
    const proposal = draft();
    expect(proposal).toEqual(draft());
    expect(metricProposalSchema.parse(proposal)).toEqual(proposal);
    expect(proposal).toMatchObject({
      schemaVersion: 1,
      status: "draft",
      metricVersion: 1,
      definition: { calculation: monthlyRevenueDefinition.calculation },
      bindings: {
        amountCents: {
          dataset: "synthetic-billing",
          table: "invoices",
          field: "amountCents",
        },
      },
      clarifications: [],
      review: null,
    });
    expect(validateProposalDefinition(proposal)).toEqual([]);
    expect(proposal.assumptions.length).toBeGreaterThan(0);
    expect(proposal.evidence.length).toBeGreaterThan(0);
    expect(() => approveMetricProposal(proposal, review)).toThrow(
      /Invalid proposal transition/,
    );
  });

  it.each([
    { schemaVersion: 2 },
    { id: " " },
    { originalRequest: "" },
    { definition: {} },
    { assumptions: [] },
    { bindings: {} },
    { sql: "SELECT * FROM invoices" },
    { relationships: [{ from: "invoices", to: "customers" }] },
    { metricVersion: 0 },
    { metricVersion: 1.5 },
    { metricVersion: Number.MAX_SAFE_INTEGER + 1 },
    { status: "needs_clarification" },
  ])("rejects malformed proposal information: %j", (change) => {
    expect(
      metricProposalSchema.safeParse({ ...draft(), ...change }).success,
    ).toBe(false);
  });

  it("rejects unsupported or contradictory aggregations and grouping", () => {
    const proposal = draft();
    for (const change of [
      { calculation: "average-paid-invoices" },
      { aggregation: "count" },
      { grouping: "customer" },
      { timezone: "America/New_York" },
      { window: "last-six-months-including-current" },
    ]) {
      expect(
        metricProposalSchema.safeParse({
          ...proposal,
          definition: { ...proposal.definition, ...change },
        }).success,
      ).toBe(false);
    }
    const missing = createMetricProposal({ ...proposal, definition: null });
    expect(validateProposalDefinition(missing)).toContain(
      "A supported metric definition is required.",
    );
    expect(() => submitMetricProposal(missing)).toThrow(
      /definition is required/,
    );
  });

  it.each([
    { dataset: "production" },
    { table: "customers" },
    { field: "refundCents" },
    { field: "__proto__" },
  ])("blocks unknown source/field references before review: %j", (change) => {
    const proposal = draft();
    const invalid = createMetricProposal({
      ...proposal,
      bindings: {
        ...proposal.bindings,
        amountCents: { ...proposal.bindings.amountCents, ...change },
      },
    });
    expect(validateProposalDefinition(invalid)).toContain(
      "Unknown source or field for amountCents.",
    );
    expect(() => submitMetricProposal(invalid)).toThrow(
      /Unknown source or field/,
    );
    expect(() => approveMetricProposal(invalid, review)).toThrow();
  });

  it("rejects a known field used in the wrong role and unknown evidence", () => {
    const proposal = draft();
    const wrongRole = createMetricProposal({
      ...proposal,
      bindings: { ...proposal.bindings, amountCents: proposal.bindings.paidAt },
    });
    expect(() => submitMetricProposal(wrongRole)).toThrow(
      /cannot be used as amountCents/,
    );
    const wrongEvidence = createMetricProposal({
      ...proposal,
      evidence: [
        {
          reference: { ...proposal.bindings.amountCents, field: "netRevenue" },
          explanation: "Untrusted claim",
        },
      ],
    });
    expect(() => submitMetricProposal(wrongEvidence)).toThrow(
      /Unknown evidence/,
    );
  });

  it("does not accept parsed, cloned, forged or imported lifecycle authority", () => {
    const ready = submitMetricProposal(draft());
    const parsed = metricProposalSchema.parse(ready);
    expect(() => approveMetricProposal(parsed, review)).toThrow(
      /active lifecycle snapshot/,
    );
    const forged = { ...ready, status: "approved" as const, review };
    expect(metricProposalSchema.safeParse(forged).success).toBe(true);
    expect(() => createMetricProposal(forged)).toThrow(/start as draft/);
    expect(() => publishMetricProposal(forged)).toThrow(
      /active lifecycle snapshot/,
    );
    expect(() =>
      createMetricProposal({ ...draft(), metricVersion: 2 }),
    ).toThrow(/version 1/);
  });

  it("rejects unsupported requests rather than guessing", () => {
    expect(() => generateMetricProposal("Show MRR", "x")).toThrow(
      /Unsupported fixture request/,
    );
    expect(() => generateMetricProposal(null, "x")).toThrow();
    expect(() =>
      generateMetricProposal(proposalExamples.monthlyRevenue, ""),
    ).toThrow();
  });
});

describe("clarification and explicit review", () => {
  it("leaves net revenue undefined and blocks review and approval until a scope decision", () => {
    const proposal = ambiguous();
    expect(proposal.originalRequest).toBe(proposalExamples.netRevenue);
    expect(proposal.definition).toBeNull();
    expect(proposal.clarifications[0]).toMatchObject({
      required: true,
      answer: null,
    });
    expect(proposal.clarifications[0]?.question).toContain(
      "net revenue subtract",
    );
    const pending = submitMetricProposal(proposal);
    expect(pending.status).toBe("needs_clarification");
    expect(() => approveMetricProposal(pending, review)).toThrow();
    expect(() => publishMetricProposal(pending)).toThrow();
    expect(
      metricProposalSchema.safeParse({ ...pending, status: "approved", review })
        .success,
    ).toBe(false);
    expect(() =>
      resolveMetricClarification(pending, "subtract refunds"),
    ).toThrow();
    expect(
      metricProposalSchema.safeParse({ ...pending, status: "ready_for_review" })
        .success,
    ).toBe(false);
    const resolved = resolveMetricClarification(
      pending,
      "use-monthly-collected-revenue",
    );
    expect(resolved.status).toBe("draft");
    expect(resolved.originalRequest).toBe(proposalExamples.netRevenue);
    expect(resolved.definition?.id).toBe("monthly-revenue");
    expect(resolved.assumptions.at(-1)).toContain("no customer grouping");
    expect(() => approveMetricProposal(resolved, review)).toThrow();
    expect(approve(resolved).status).toBe("approved");
  });

  it("requires an explicit reviewer and rejects invalid transitions and stale snapshots", () => {
    const proposal = draft();
    expect(() =>
      resolveMetricClarification(proposal, "use-monthly-collected-revenue"),
    ).toThrow();
    expect(() => publishMetricProposal(proposal)).toThrow();
    const ready = submitMetricProposal(proposal);
    expect(() => submitMetricProposal(proposal)).toThrow(
      /active lifecycle snapshot/,
    );
    expect(() => rejectMetricProposal(proposal, "Old draft")).toThrow();
    expect(() => submitMetricProposal(ready)).toThrow();
    expect(() => approveMetricProposal(ready, { reviewer: " " })).toThrow();
    const approved = approveMetricProposal(ready, review);
    expect(approved.review).toEqual(review);
    expect(() => approveMetricProposal(approved, review)).toThrow();
    expect(() => rejectMetricProposal(approved, "Too late")).toThrow();
    expect(() => editMetricProposal(approved, content(approved))).toThrow();
  });

  it.each(["draft", "needs_clarification", "ready_for_review"] as const)(
    "can reject %s with a reason; rejection is terminal",
    (state) => {
      const proposal =
        state === "draft"
          ? draft()
          : submitMetricProposal(
              state === "needs_clarification" ? ambiguous() : draft(),
            );
      expect(() => rejectMetricProposal(proposal, "")).toThrow();
      const rejected = rejectMetricProposal(
        proposal,
        "Business definition not accepted",
      );
      expect(rejected.status).toBe("rejected");
      expect(rejected.rejectionReason).toBe("Business definition not accepted");
      expect(() => submitMetricProposal(rejected)).toThrow();
      expect(() => approveMetricProposal(rejected, review)).toThrow();
      expect(() => publishMetricProposal(rejected)).toThrow();
      expect(() => editMetricProposal(rejected, content(rejected))).toThrow();
    },
  );

  it("invalidates readiness after any content edit and keeps snapshot history untouched", () => {
    const ready = submitMetricProposal(draft());
    const updated = editMetricProposal(ready, {
      ...content(ready),
      assumptions: [...ready.assumptions, "Reviewed fixture only"],
    });
    expect(updated.status).toBe("draft");
    expect(ready.assumptions).not.toContain("Reviewed fixture only");
    expect(() => approveMetricProposal(ready, review)).toThrow();
    expect(() => approveMetricProposal(updated, review)).toThrow();
    expect(approve(updated).status).toBe("approved");
  });
});

describe("immutable metric publication and deterministic compatibility", () => {
  it("publishes only approved snapshots and freezes all nested content", () => {
    const approved = approve();
    const publication = publishMetricProposal(approved);
    expect(publication.definition).toEqual(monthlyRevenueDefinition);
    expect(publishedMetricVersionSchema.parse(publication)).toEqual(
      publication,
    );
    expect(publishMetricProposal(approved)).toBe(publication);
    expect(Object.isFrozen(approved.bindings.amountCents)).toBe(true);
    expect(Object.isFrozen(publication.proposal.assumptions)).toBe(true);
    expect(() =>
      Object.assign(publication.definition, { name: "Tampered" }),
    ).toThrow(TypeError);
    expect(() =>
      Object.assign(approved.assumptions, { 0: "Tampered" }),
    ).toThrow(TypeError);
    expect(() => editMetricProposal(approved, content(approved))).toThrow();
    expect(() =>
      reviseMetricVersion({ ...publication }, "proposal-2"),
    ).toThrow();
    expect(
      publishedMetricVersionSchema.safeParse({
        ...publication,
        definition: { ...publication.definition, version: 2 },
      }).success,
    ).toBe(false);
    expect(
      publishedMetricVersionSchema.safeParse({
        ...publication,
        proposal: draft(),
      }).success,
    ).toBe(false);
  });

  it("creates and reviews a new version without mutating v1; stale revisions cannot fork", () => {
    const first = publishMetricProposal(approve());
    const snapshot = JSON.stringify(first);
    expect(() => reviseMetricVersion(first, first.proposal.id)).toThrow(
      /new proposal identifier/,
    );
    const revision = reviseMetricVersion(first, "proposal-2");
    expect(revision).toMatchObject({
      status: "draft",
      metricVersion: 2,
      review: null,
    });
    expect(() => publishMetricProposal(revision)).toThrow();
    expect(() => reviseMetricVersion(first, "fork")).toThrow(
      /existing successor/,
    );
    const changed = editMetricProposal(revision, {
      ...content(revision),
      assumptions: [
        ...revision.assumptions,
        "Second review of the same supported calculation",
      ],
    });
    const second = publishMetricProposal(approve(changed));
    expect(second.definition.version).toBe(2);
    expect(second.proposal.id).toBe("proposal-2");
    expect(JSON.stringify(first)).toBe(snapshot);
    expect(
      monthlyRevenueDefinitionSchema.safeParse(second.definition).success,
    ).toBe(false);

    const input = {
      asOf: "2026-07-01",
      invoices: [
        {
          id: "a",
          amountCents: 12_345,
          currency: "USD",
          status: "paid",
          paidAt: "2026-06-01T00:00:00Z",
        },
      ],
    };
    const firstResult = calculateMonthlyRevenue(first.definition, input);
    const secondResult = calculateMonthlyRevenue(second.definition, input);
    expect(firstResult.points).toEqual(secondResult.points);
    expect(secondResult.points.at(-1)?.valueCents).toBe(12_345);
    expect(secondResult.metricVersion).toBe(2);
    expect(firstResult.metricVersion).toBe(1);
  });

  it("approval validates the definition, not the numerical correctness of caller data", () => {
    const publication = publishMetricProposal(approve());
    expect(() =>
      calculateMonthlyRevenue(publication.definition, {
        asOf: "2026-07-01",
        invoices: [{ amountCents: -1 }],
      }),
    ).toThrow();
  });
});
