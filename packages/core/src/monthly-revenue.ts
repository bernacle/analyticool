import { z } from "zod";

const centsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const asOfSchema = z.iso.date();

/** The only executable definition in the bootstrap. No arbitrary queries or code. */
export const monthlyRevenueDefinitionSchema = z.strictObject({
  id: z.literal("monthly-revenue"),
  version: z.literal(1),
  name: z.literal("Monthly collected revenue"),
  question: z.literal("Show monthly revenue for the last six months."),
  calculation: z.literal("sum-paid-invoices-by-payment-month"),
  currency: z.literal("USD"),
  timezone: z.literal("UTC"),
  window: z.literal("last-six-complete-months"),
});

export type MonthlyRevenueDefinition = z.infer<
  typeof monthlyRevenueDefinitionSchema
>;

export const monthlyRevenueDefinition: Readonly<MonthlyRevenueDefinition> =
  Object.freeze(
    monthlyRevenueDefinitionSchema.parse({
      id: "monthly-revenue",
      version: 1,
      name: "Monthly collected revenue",
      question: "Show monthly revenue for the last six months.",
      calculation: "sum-paid-invoices-by-payment-month",
      currency: "USD",
      timezone: "UTC",
      window: "last-six-complete-months",
    }),
  );

export const revenueAssumptions = Object.freeze([
  "Sum the full amount of USD invoices whose status is paid, using the payment timestamp.",
  "Use the six complete calendar months before the as-of month, in UTC; exclude the current partial month.",
  "Exclude open, void, and refunded invoices entirely. This is collected revenue, not MRR, net revenue, or accounting revenue recognition.",
  "Store and sum integer cents. Do not convert currencies or prorate annual invoices.",
  "Include months with no eligible payments as zero. Reject duplicate invoice IDs and unsafe totals.",
]);

export const invoiceSchema = z
  .strictObject({
    id: z.string().min(1),
    amountCents: centsSchema,
    currency: z.literal("USD"),
    status: z.enum(["paid", "open", "void", "refunded"]),
    paidAt: z.iso
      .datetime({ offset: true })
      .refine(
        (value) => Number.isFinite(Date.parse(value)),
        "Payment timestamp must represent a valid instant.",
      )
      .nullable(),
  })
  .refine(
    (invoice) =>
      invoice.status === "paid" || invoice.status === "refunded"
        ? invoice.paidAt !== null
        : invoice.paidAt === null,
    {
      message:
        "Paid/refunded invoices require paidAt; open/void invoices require null.",
      path: ["paidAt"],
    },
  );

export type Invoice = z.infer<typeof invoiceSchema>;

const executionInputSchema = z
  .strictObject({
    asOf: asOfSchema,
    invoices: z.array(invoiceSchema),
  })
  .refine(
    (input) =>
      new Set(input.invoices.map((invoice) => invoice.id)).size ===
      input.invoices.length,
    {
      message: "Invoice IDs must be unique.",
      path: ["invoices"],
    },
  );

function completeMonths(asOf: string): string[] {
  const anchor = new Date(`${asOf.slice(0, 7)}-01T00:00:00.000Z`);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCMonth(date.getUTCMonth() - 6 + index);
    return date.toISOString().slice(0, 7);
  });
}

export const monthlyRevenueResultSchema = z
  .strictObject({
    metricId: z.literal("monthly-revenue"),
    metricVersion: z.literal(1),
    asOf: asOfSchema,
    currency: z.literal("USD"),
    timezone: z.literal("UTC"),
    points: z
      .array(z.strictObject({ month: monthSchema, valueCents: centsSchema }))
      .length(6),
  })
  .refine(
    (result) =>
      asOfSchema.safeParse(result.asOf).success &&
      completeMonths(result.asOf).every(
        (month, index) => result.points[index]?.month === month,
      ),
    {
      message:
        "Points must be the six ordered, complete UTC months before asOf.",
      path: ["points"],
    },
  );

export type MonthlyRevenueResult = z.infer<typeof monthlyRevenueResultSchema>;

/** Pure, deterministic calculation over caller-supplied, already-authorized rows. */
export function calculateMonthlyRevenue(
  definition: MonthlyRevenueDefinition,
  input: unknown,
): MonthlyRevenueResult {
  const metric = monthlyRevenueDefinitionSchema.parse(definition);
  const { invoices, asOf } = executionInputSchema.parse(input);
  const totals = new Map(completeMonths(asOf).map((month) => [month, 0]));

  for (const invoice of invoices) {
    if (invoice.status !== "paid" || invoice.paidAt === null) continue;
    const month = new Date(invoice.paidAt).toISOString().slice(0, 7);
    const current = totals.get(month);
    if (current === undefined) continue;
    const total = current + invoice.amountCents;
    if (!Number.isSafeInteger(total))
      throw new RangeError("Monthly revenue exceeds safe integer cents.");
    totals.set(month, total);
  }

  return monthlyRevenueResultSchema.parse({
    metricId: metric.id,
    metricVersion: metric.version,
    asOf,
    currency: metric.currency,
    timezone: metric.timezone,
    points: Array.from(totals, ([month, valueCents]) => ({
      month,
      valueCents,
    })),
  });
}
