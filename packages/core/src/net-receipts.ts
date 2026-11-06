import { z } from "zod";

const id = z
  .string()
  .min(1)
  .refine((s) => s === s.trim(), "IDs must not have surrounding whitespace.");
const signedCents = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const sourceCents = signedCents.nonnegative();
const instant = z.iso
  .datetime({ offset: true })
  .refine((s) => Number.isFinite(Date.parse(s)), "Invalid instant.");
// Keep the six-month window representable with four-digit ISO years.
const asOf = z.iso
  .date()
  .refine(
    (s) => s >= "0001-07-01",
    "Reporting window must be within four-digit ISO years.",
  );
const eventType = z.enum(["original", "reversal", "correction"]);

/** A closed calculation policy, separate from collected-revenue v1 and approval. */
export const netReceiptsDefinitionSchema = z.strictObject({
  id: z.literal("operational-net-receipts"),
  version: z.literal(1),
  name: z.literal("Operational net receipts"),
  calculation: z.literal("captured-minus-settled-refunds-minus-posted-fees-v1"),
  currency: z.literal("USD"),
  unit: z.literal("integer-cents"),
  timezone: z.literal("UTC"),
  window: z.literal("last-six-complete-calendar-months"),
  sourceContract: z.literal("net-receipts-event-streams-v1"),
  attribution: z.literal(
    "capture-settlement-posting-month-including-historical-parents",
  ),
  aggregation: z.literal("independent-streams-then-monthly-sum"),
  ownership: z.literal("adjustment-tenant-and-parent-charge-tenant-must-match"),
  missingParents: z.literal("block"),
  duplicates: z.literal("reject-per-stream"),
  corrections: z.literal("unsupported-block"),
  emptyMonths: z.literal("zero-only-with-all-streams-declared-complete"),
  scope: z.literal(
    "operational-only-no-fx-proration-tax-subtraction-or-payout-reconciliation",
  ),
});
export type NetReceiptsDefinition = z.infer<typeof netReceiptsDefinitionSchema>;
export const netReceiptsDefinition: Readonly<NetReceiptsDefinition> =
  Object.freeze(
    netReceiptsDefinitionSchema.parse({
      id: "operational-net-receipts",
      version: 1,
      name: "Operational net receipts",
      calculation: "captured-minus-settled-refunds-minus-posted-fees-v1",
      currency: "USD",
      unit: "integer-cents",
      timezone: "UTC",
      window: "last-six-complete-calendar-months",
      sourceContract: "net-receipts-event-streams-v1",
      attribution:
        "capture-settlement-posting-month-including-historical-parents",
      aggregation: "independent-streams-then-monthly-sum",
      ownership: "adjustment-tenant-and-parent-charge-tenant-must-match",
      missingParents: "block",
      duplicates: "reject-per-stream",
      corrections: "unsupported-block",
      emptyMonths: "zero-only-with-all-streams-declared-complete",
      scope:
        "operational-only-no-fx-proration-tax-subtraction-or-payout-reconciliation",
    }),
  );

export const netReceiptsChargeSchema = z.strictObject({
  id,
  tenantId: id,
  amountCents: sourceCents,
  currency: z.literal("USD"),
});
export const netReceiptsPaymentSchema = z
  .strictObject({
    id,
    chargeId: id,
    eventType,
    status: z.enum(["captured", "pending", "failed"]),
    capturedAt: instant.nullable(),
  })
  .refine(
    (p) => p.status !== "captured" || p.capturedAt !== null,
    "Captured payments require capturedAt.",
  );
export const netReceiptsRefundSchema = z
  .strictObject({
    id,
    tenantId: id,
    paymentId: id,
    eventType,
    amountCents: sourceCents,
    currency: z.literal("USD"),
    status: z.enum(["settled", "pending", "failed"]),
    settledAt: instant.nullable(),
  })
  .refine(
    (r) => r.status !== "settled" || r.settledAt !== null,
    "Settled refunds require settledAt.",
  );
export const netReceiptsFeeSchema = z
  .strictObject({
    id,
    tenantId: id,
    paymentId: id,
    eventType,
    amountCents: sourceCents,
    currency: z.literal("USD"),
    status: z.enum(["posted", "pending", "failed"]),
    postedAt: instant.nullable(),
  })
  .refine(
    (f) => f.status !== "posted" || f.postedAt !== null,
    "Posted fees require postedAt.",
  );

function stream<T extends z.ZodType>(row: T) {
  return z.strictObject({
    completeness: z.enum(["declared-complete", "incomplete", "unknown"]),
    rows: z.array(row),
  });
}
export const netReceiptsInputSchema = z.strictObject({
  asOf,
  tenantId: id,
  charges: stream(netReceiptsChargeSchema),
  payments: stream(netReceiptsPaymentSchema),
  refunds: stream(netReceiptsRefundSchema),
  fees: stream(netReceiptsFeeSchema),
});
export type NetReceiptsInput = z.infer<typeof netReceiptsInputSchema>;

export function netReceiptsPeriod(date: string) {
  const validated = asOf.parse(date);
  const end = new Date(`${validated.slice(0, 7)}-01T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 6);
  const months = Array.from({ length: 6 }, (_, i) => {
    const month = new Date(start);
    month.setUTCMonth(month.getUTCMonth() + i);
    return month.toISOString().slice(0, 7);
  });
  return {
    startInclusive: start.toISOString(),
    endExclusive: end.toISOString(),
    months,
  };
}

const componentsSchema = z.strictObject({
  capturedCents: sourceCents,
  settledRefundCents: sourceCents,
  postedFeeCents: sourceCents,
  netCents: signedCents,
});
export const netReceiptsResultSchema = z
  .strictObject({
    metricId: z.literal("operational-net-receipts"),
    metricVersion: z.literal(1),
    asOf,
    tenantId: id,
    currency: z.literal("USD"),
    timezone: z.literal("UTC"),
    startInclusive: instant,
    endExclusive: instant,
    points: z
      .array(
        componentsSchema.extend({
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        }),
      )
      .length(6),
    totals: componentsSchema,
  })
  .superRefine((result, ctx) => {
    if (!asOf.safeParse(result.asOf).success) return;
    const period = netReceiptsPeriod(result.asOf);
    if (
      result.startInclusive !== period.startInclusive ||
      result.endExclusive !== period.endExclusive ||
      period.months.some((m, i) => result.points[i]?.month !== m)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Expected the six ordered complete UTC months and matching period.",
      });
    }
    // Refinements can also run for dirty number parses; never convert invalid numbers to BigInt.
    if (
      ![...result.points, result.totals].every((p) =>
        Object.values(p).every(
          (v) => typeof v !== "number" || Number.isSafeInteger(v),
        ),
      )
    )
      return;
    for (const p of [...result.points, result.totals]) {
      if (
        BigInt(p.netCents) !==
        BigInt(p.capturedCents) -
          BigInt(p.settledRefundCents) -
          BigInt(p.postedFeeCents)
      )
        ctx.addIssue({
          code: "custom",
          message: "Net must equal captured minus refunds minus fees.",
        });
    }
    for (const key of [
      "capturedCents",
      "settledRefundCents",
      "postedFeeCents",
      "netCents",
    ] as const) {
      if (
        result.points.reduce((s, p) => s + BigInt(p[key]), 0n) !==
        BigInt(result.totals[key])
      )
        ctx.addIssue({
          code: "custom",
          message: `Grand total mismatch: ${key}.`,
        });
    }
  });
export type NetReceiptsResult = z.infer<typeof netReceiptsResultSchema>;
export type NetReceiptsIssueCode =
  | "INVALID_INPUT"
  | "INCOMPLETE_STREAM"
  | "DUPLICATE_ID"
  | "UNKNOWN_CHARGE"
  | "UNKNOWN_PAYMENT"
  | "CROSS_TENANT_PARENT"
  | "NONCAPTURED_PARENT"
  | "MULTIPLE_CAPTURES"
  | "UNSUPPORTED_EVENT"
  | "UNSAFE_CENTS";
export class NetReceiptsCalculationError extends Error {
  constructor(public readonly code: NetReceiptsIssueCode) {
    super(`Operational net receipts blocked: ${code}.`);
    this.name = "NetReceiptsCalculationError";
  }
}
function block(code: NetReceiptsIssueCode): never {
  throw new NetReceiptsCalculationError(code);
}
function safe(value: bigint): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    block("UNSAFE_CENTS");
  return Number(value);
}

/** Local tenant policy over supplied rows, NOT source authorization or completeness proof. */
export function calculateNetReceipts(
  definition: NetReceiptsDefinition,
  input: unknown,
): NetReceiptsResult {
  const metric = netReceiptsDefinitionSchema.safeParse(definition);
  const parsed = netReceiptsInputSchema.safeParse(input);
  if (!metric.success || !parsed.success) block("INVALID_INPUT");
  const data = parsed.data;
  for (const stream of [data.charges, data.payments, data.refunds, data.fees]) {
    if (stream.completeness !== "declared-complete") block("INCOMPLETE_STREAM");
    if (new Set(stream.rows.map((r) => r.id)).size !== stream.rows.length)
      block("DUPLICATE_ID");
  }
  const period = netReceiptsPeriod(data.asOf);
  const buckets = new Map(
    period.months.map((m) => [
      m,
      { capturedCents: 0n, settledRefundCents: 0n, postedFeeCents: 0n },
    ]),
  );
  const charges = new Map(data.charges.rows.map((c) => [c.id, c]));
  const payments = new Map(data.payments.rows.map((p) => [p.id, p]));
  const captures = new Set<string>();
  function add(
    at: string,
    key: "capturedCents" | "settledRefundCents" | "postedFeeCents",
    cents: number,
  ) {
    const bucket = buckets.get(new Date(at).toISOString().slice(0, 7));
    if (bucket) bucket[key] += BigInt(cents);
  }
  for (const p of data.payments.rows) {
    const charge = charges.get(p.chargeId);
    // A tenantless payment cannot be classified without its charge.
    if (!charge) block("UNKNOWN_CHARGE");
    if (charge.tenantId !== data.tenantId) continue;
    if (p.eventType !== "original") block("UNSUPPORTED_EVENT");
    if (p.status !== "captured" || p.capturedAt === null) continue;
    if (captures.has(charge.id)) block("MULTIPLE_CAPTURES");
    captures.add(charge.id);
    add(p.capturedAt, "capturedCents", charge.amountCents);
  }
  function parent(paymentId: string) {
    const p = payments.get(paymentId);
    if (!p) block("UNKNOWN_PAYMENT");
    const c = charges.get(p.chargeId);
    if (!c) block("UNKNOWN_CHARGE");
    if (c.tenantId !== data.tenantId) block("CROSS_TENANT_PARENT");
    return p;
  }
  for (const rows of [data.refunds.rows, data.fees.rows]) {
    for (const adjustment of rows) {
      // Scope adjustments independently, BEFORE looking up their parent.
      if (adjustment.tenantId !== data.tenantId) continue;
      if (adjustment.eventType !== "original") block("UNSUPPORTED_EVENT");
      const p = parent(adjustment.paymentId);
      if (adjustment.status === "pending" || adjustment.status === "failed")
        continue;
      if (p.status !== "captured") block("NONCAPTURED_PARENT");
      if ("settledAt" in adjustment && adjustment.settledAt !== null)
        add(adjustment.settledAt, "settledRefundCents", adjustment.amountCents);
      if ("postedAt" in adjustment && adjustment.postedAt !== null)
        add(adjustment.postedAt, "postedFeeCents", adjustment.amountCents);
    }
  }
  const values = (p: {
    capturedCents: bigint;
    settledRefundCents: bigint;
    postedFeeCents: bigint;
  }) => ({
    capturedCents: safe(p.capturedCents),
    settledRefundCents: safe(p.settledRefundCents),
    postedFeeCents: safe(p.postedFeeCents),
    netCents: safe(p.capturedCents - p.settledRefundCents - p.postedFeeCents),
  });
  const totals = {
    capturedCents: 0n,
    settledRefundCents: 0n,
    postedFeeCents: 0n,
  };
  const points = Array.from(buckets, ([month, p]) => {
    for (const k of [
      "capturedCents",
      "settledRefundCents",
      "postedFeeCents",
    ] as const)
      totals[k] += p[k];
    return { month, ...values(p) };
  });
  return netReceiptsResultSchema.parse({
    metricId: metric.data.id,
    metricVersion: metric.data.version,
    asOf: data.asOf,
    tenantId: data.tenantId,
    currency: "USD",
    timezone: "UTC",
    startInclusive: period.startInclusive,
    endExclusive: period.endExclusive,
    points,
    totals: values(totals),
  });
}
