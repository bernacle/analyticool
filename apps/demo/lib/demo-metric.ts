import {
  calculateMonthlyRevenue,
  monthlyRevenueDefinition,
  type Invoice,
  type VersionedMonthlyRevenueDefinition,
} from "@analyticool/core";

// Explicitly fictional workspaces. This is a fixture selection, not authorization.
const demoWorkspace = "fictional-acme";
export const demoAsOf = "2026-07-01";

const monthlyAmounts = [200_000, 225_000, 249_000, 275_000, 310_000, 342_000];
const fixtures: ReadonlyArray<Invoice & { workspaceId: string }> = [
  ...monthlyAmounts.flatMap((amountCents, index) => [
    {
      id: `acme-${index}-a`,
      workspaceId: demoWorkspace,
      amountCents: amountCents - 50_000,
      currency: "USD" as const,
      status: "paid" as const,
      paidAt: `2026-0${index + 1}-05T12:00:00Z`,
    },
    {
      id: `acme-${index}-b`,
      workspaceId: demoWorkspace,
      amountCents: 50_000,
      currency: "USD" as const,
      status: "paid" as const,
      paidAt: `2026-0${index + 1}-20T12:00:00Z`,
    },
  ]),
  {
    id: "acme-open",
    workspaceId: demoWorkspace,
    amountCents: 90_000,
    currency: "USD",
    status: "open",
    paidAt: null,
  },
  {
    id: "acme-refunded",
    workspaceId: demoWorkspace,
    amountCents: 15_000,
    currency: "USD",
    status: "refunded",
    paidAt: "2026-06-15T12:00:00Z",
  },
  {
    id: "acme-current",
    workspaceId: demoWorkspace,
    amountCents: 99_000,
    currency: "USD",
    status: "paid",
    paidAt: "2026-07-01T00:00:00Z",
  },
  {
    id: "other-paid",
    workspaceId: "fictional-orbit",
    amountCents: 9_999_999,
    currency: "USD",
    status: "paid",
    paidAt: "2026-06-01T12:00:00Z",
  },
];

/** The definition can be versioned; workspace selection always stays fixed. */
export function getDemoMetric(
  definition: VersionedMonthlyRevenueDefinition = monthlyRevenueDefinition,
) {
  const invoices = fixtures
    .filter((row) => row.workspaceId === demoWorkspace)
    .map(({ id, amountCents, currency, status, paidAt }) => ({
      id,
      amountCents,
      currency,
      status,
      paidAt,
    }));
  return calculateMonthlyRevenue(definition, {
    asOf: demoAsOf,
    invoices,
  });
}
