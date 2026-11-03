import { z } from "zod";
import {
  monthlyRevenueDefinition,
  revenueAssumptions,
} from "./monthly-revenue";
import {
  clarificationQuestion,
  createMetricProposal,
  fixtureCatalog,
  type MetricProposal,
} from "./proposal";

export const proposalExamples = Object.freeze({
  monthlyRevenue: monthlyRevenueDefinition.question,
  netRevenue: "Show net revenue by customer.",
});

/** Two fixture scenarios only; no general natural-language parsing or external IO. */
export function generateMetricProposal(
  request: unknown,
  proposalId: unknown,
): MetricProposal {
  const originalRequest = z.string().trim().min(1).max(4_000).parse(request);
  const normalized = originalRequest.toLowerCase().replace(/\.$/, "");
  const ambiguous =
    normalized === proposalExamples.netRevenue.toLowerCase().replace(/\.$/, "");
  if (
    !ambiguous &&
    normalized !==
      proposalExamples.monthlyRevenue.toLowerCase().replace(/\.$/, "")
  ) {
    throw new Error(
      "Unsupported fixture request. Select one of the two example questions.",
    );
  }
  const reference = (field: string) => ({
    dataset: fixtureCatalog.dataset,
    table: fixtureCatalog.table,
    field,
  });
  const { id, name, question, calculation, currency, timezone, window } =
    monthlyRevenueDefinition;
  return createMetricProposal({
    schemaVersion: 1,
    id: proposalId,
    originalRequest,
    metricVersion: 1,
    definition: ambiguous
      ? null
      : { id, name, question, calculation, currency, timezone, window },
    bindings: {
      amountCents: reference("amountCents"),
      currency: reference("currency"),
      status: reference("status"),
      paidAt: reference("paidAt"),
    },
    relationships: [],
    assumptions: [...revenueAssumptions],
    clarifications: ambiguous
      ? [
          {
            id: "net-revenue-scope",
            question: clarificationQuestion,
            required: true,
            answer: null,
          },
        ]
      : [],
    evidence: [
      {
        reference: reference("amountCents"),
        explanation: fixtureCatalog.fields.amountCents,
      },
      {
        reference: reference("paidAt"),
        explanation:
          "Payment instant supports UTC payment-month grouping, not invoice-date grouping.",
      },
      {
        reference: reference("status"),
        explanation:
          "Paid-only collection is supported. No customer key, refund amount, discount, tax, or fee fields exist in these fixtures.",
      },
    ],
    status: "draft",
    review: null,
    rejectionReason: null,
  });
}
