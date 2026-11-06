import { isDeepStrictEqual } from "node:util";
import fixture from "./bru-482.fixture.json";
import oracle from "./bru-482.expected.json";
import {
  calculateNetReceipts,
  NetReceiptsCalculationError,
  netReceiptsDefinition,
  netReceiptsInputSchema,
  netReceiptsPeriod,
  type NetReceiptsInput,
  type NetReceiptsIssueCode,
  type NetReceiptsResult,
} from "../../packages/core/src/net-receipts";

export const freshInput = (): NetReceiptsInput =>
  netReceiptsInputSchema.parse(fixture.input);
type Values = Pick<NetReceiptsResult, "points" | "totals">;
type Outcome =
  | { kind: "completed"; values: Values }
  | { kind: "rejected"; code: NetReceiptsIssueCode };
type Case = { id: string; input: unknown; expected: Outcome };
const completed = (values: Values): Outcome => ({ kind: "completed", values });
const baseline = completed({ points: oracle.points, totals: oracle.totals });
const rejected = (
  code: NetReceiptsIssueCode,
): Extract<Outcome, { kind: "rejected" }> => ({
  kind: "rejected",
  code,
});
const keys = ["charges", "payments", "refunds", "fees"] as const;
function appendAdjustment(
  input: NetReceiptsInput,
  key: "refunds" | "fees",
  change: Partial<
    Pick<
      NetReceiptsInput["refunds"]["rows"][number],
      "id" | "paymentId" | "tenantId" | "amountCents"
    >
  > & { status?: "pending" | "failed" },
) {
  if (key === "refunds")
    input.refunds.rows.push({ ...input.refunds.rows[0]!, ...change });
  else input.fees.rows.push({ ...input.fees.rows[0]!, ...change });
}
const empty = (): NetReceiptsInput => {
  const input = freshInput();
  for (const key of keys) input[key].rows = [];
  return input;
};
const zeroValues: Values = {
  points: oracle.points.map((p) => ({
    month: p.month,
    capturedCents: 0,
    settledRefundCents: 0,
    postedFeeCents: 0,
    netCents: 0,
  })),
  totals: {
    capturedCents: 0,
    settledRefundCents: 0,
    postedFeeCents: 0,
    netCents: 0,
  },
};

/** Cases and expectations are authored independently; never derived by running the candidate. */
export function verificationCases(): Case[] {
  const cases: Case[] = [
    {
      id: "acme-six-month-components-and-total",
      input: freshInput(),
      expected: baseline,
    },
  ];
  const add = (
    id: string,
    edit: (input: NetReceiptsInput) => void,
    expected: Outcome = baseline,
  ) => {
    const input = freshInput();
    edit(input);
    cases.push({ id, input, expected });
  };
  add("input-order-reversed", (i) => {
    for (const key of keys) i[key].rows.reverse();
  });
  add(
    "historical-parent-partial-refunds-and-fanout",
    (i) => {
      i.charges.rows = i.charges.rows.filter((c) =>
        ["c1", "old"].includes(c.id),
      );
      i.payments.rows = i.payments.rows.filter((p) =>
        ["p1", "po"].includes(p.id),
      );
      i.refunds.rows = i.refunds.rows.filter((r) =>
        ["r1", "r2", "r4"].includes(r.id),
      );
      i.fees.rows = i.fees.rows.filter((f) => ["f1", "f2"].includes(f.id));
    },
    completed({
      points: [
        oracle.points[0]!,
        {
          month: "2026-02",
          capturedCents: 0,
          settledRefundCents: 1500,
          postedFeeCents: 0,
          netCents: -1500,
        },
        ...zeroValues.points.slice(2),
      ],
      totals: {
        capturedCents: 10000,
        settledRefundCents: 4500,
        postedFeeCents: 350,
        netCents: 5150,
      },
    }),
  );
  add(
    "orbit-independently-scoped",
    (i) => {
      i.tenantId = "orbit";
    },
    completed({
      points: zeroValues.points.map((p) =>
        p.month === "2026-02" ? { month: p.month, ...oracle.orbitFebruary } : p,
      ),
      totals: oracle.orbitFebruary,
    }),
  );
  for (const key of ["refunds", "fees"] as const) {
    for (const [suffix, paymentId, code] of [
      ["unknown-parent", "missing", "UNKNOWN_PAYMENT"],
      ["cross-tenant-parent", "pb", "CROSS_TENANT_PARENT"],
      ["noncaptured-parent", "p3", "NONCAPTURED_PARENT"],
    ] as const) {
      add(
        `${key}-${suffix}`,
        (i) => {
          appendAdjustment(i, key, { id: "injected", paymentId });
        },
        rejected(code),
      );
    }
    add(`${key}-foreign-adjustment-to-acme-parent-excluded`, (i) => {
      appendAdjustment(i, key, {
        id: "foreign",
        tenantId: "orbit",
        paymentId: "p1",
        amountCents: 999999,
      });
    });
    add(`${key}-foreign-orphan-excluded-before-parent-lookup`, (i) => {
      appendAdjustment(i, key, {
        id: "foreign",
        tenantId: "orbit",
        paymentId: "missing",
      });
    });
    for (const status of ["failed", "pending"] as const) {
      add(`${key}-${status}-excluded`, (i) => {
        appendAdjustment(i, key, {
          id: status,
          status,
          amountCents: 999999,
        });
      });
      add(
        `${key}-${status}-orphan-still-blocks`,
        (i) => {
          appendAdjustment(i, key, {
            id: status,
            status,
            paymentId: "missing",
          });
        },
        rejected("UNKNOWN_PAYMENT"),
      );
    }
  }
  add("pending-payment-excluded", (i) => {
    i.payments.rows.push({
      ...i.payments.rows[0]!,
      id: "pending",
      status: "pending",
    });
  });
  add(
    "pending-refund-becomes-settled-own-month",
    (i) => {
      const r = i.refunds.rows.find((r) => r.id === "rp")!;
      r.status = "settled";
      r.settledAt = "2026-06-30T23:00:00Z";
    },
    completed({
      points: [
        ...oracle.points.slice(0, 5),
        {
          month: "2026-06",
          capturedCents: 30000,
          settledRefundCents: 4000,
          postedFeeCents: 900,
          netCents: 25100,
        },
      ],
      totals: {
        capturedCents: 60000,
        settledRefundCents: 10500,
        postedFeeCents: 1850,
        netCents: 47650,
      },
    }),
  );
  for (const key of keys) {
    add(
      `${key}-duplicate-id`,
      (i) => {
        i[key].rows.push({ ...i[key].rows[0]! } as never);
      },
      rejected("DUPLICATE_ID"),
    );
    add(
      `${key}-conflicting-duplicate-id`,
      (i) => {
        i[key].rows.push({
          ...i[key].rows[0]!,
          id: i[key].rows[1]!.id,
        } as never);
      },
      rejected("DUPLICATE_ID"),
    );
    add(
      `${key}-incomplete`,
      (i) => {
        i[key].completeness = "incomplete";
      },
      rejected("INCOMPLETE_STREAM"),
    );
    add(
      `${key}-unknown-completeness`,
      (i) => {
        i[key].completeness = "unknown";
      },
      rejected("INCOMPLETE_STREAM"),
    );
    const missing: Record<string, unknown> = freshInput();
    delete missing[key];
    cases.push({
      id: `${key}-missing`,
      input: missing,
      expected: rejected("INVALID_INPUT"),
    });
  }
  add(
    "unknown-charge",
    (i) => {
      i.payments.rows[0]!.chargeId = "missing";
    },
    rejected("UNKNOWN_CHARGE"),
  );
  add(
    "multiple-captures-per-charge",
    (i) => {
      i.payments.rows.push({ ...i.payments.rows[0]!, id: "second-capture" });
    },
    rejected("MULTIPLE_CAPTURES"),
  );
  for (const key of ["payments", "refunds", "fees"] as const) {
    for (const eventType of ["reversal", "correction"] as const) {
      add(
        `${key}-${eventType}-blocks`,
        (i) => {
          i[key].rows[0]!.eventType = eventType;
        },
        rejected("UNSUPPORTED_EVENT"),
      );
    }
  }
  cases.push({
    id: "all-explicitly-empty-complete",
    input: empty(),
    expected: completed(zeroValues),
  });
  for (const key of ["charges", "refunds", "fees"] as const) {
    for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      add(
        `${key}-invalid-cents-${amount}`,
        (i) => {
          i[key].rows[0]!.amountCents = amount;
        },
        rejected("INVALID_INPUT"),
      );
    }
    const currency: Record<string, unknown> = freshInput();
    (currency[key] as { rows: Record<string, unknown>[] }).rows[0]!.currency =
      "EUR";
    cases.push({
      id: `${key}-unsupported-currency`,
      input: currency,
      expected: rejected("INVALID_INPUT"),
    });
  }
  const chargeOverflow = (sameMonth: boolean) => {
    const i = empty();
    i.charges.rows = [
      {
        id: "max",
        tenantId: "acme",
        currency: "USD",
        amountCents: Number.MAX_SAFE_INTEGER,
      },
      { id: "one", tenantId: "acme", currency: "USD", amountCents: 1 },
    ];
    i.payments.rows = i.charges.rows.map((c, index) => ({
      id: c.id,
      chargeId: c.id,
      status: "captured",
      eventType: "original",
      capturedAt:
        index === 0 || sameMonth
          ? "2026-01-01T00:00:00Z"
          : "2026-02-01T00:00:00Z",
    }));
    return i;
  };
  cases.push(
    {
      id: "monthly-component-overflow",
      input: chargeOverflow(true),
      expected: rejected("UNSAFE_CENTS"),
    },
    {
      id: "grand-component-overflow",
      input: chargeOverflow(false),
      expected: rejected("UNSAFE_CENTS"),
    },
  );
  const hidden = chargeOverflow(true);
  hidden.refunds.rows = [
    {
      ...freshInput().refunds.rows[0]!,
      paymentId: "max",
      amountCents: Number.MAX_SAFE_INTEGER,
      settledAt: "2026-01-01T00:00:00Z",
    },
  ];
  cases.push({
    id: "unsafe-component-hidden-by-safe-net",
    input: hidden,
    expected: rejected("UNSAFE_CENTS"),
  });
  for (const key of ["refunds", "fees"] as const) {
    for (const scope of ["monthly", "grand"] as const) {
      const input = chargeOverflow(true);
      input.charges.rows.pop();
      input.payments.rows.pop();
      const change = { paymentId: "max", amountCents: Number.MAX_SAFE_INTEGER };
      const firstAt = "2026-01-01T00:00:00Z";
      const secondAt = scope === "monthly" ? firstAt : "2026-02-01T00:00:00Z";
      if (key === "refunds")
        input.refunds.rows = [
          { ...freshInput().refunds.rows[0]!, ...change, settledAt: firstAt },
          {
            ...freshInput().refunds.rows[0]!,
            id: "extra",
            paymentId: "max",
            amountCents: 1,
            settledAt: secondAt,
          },
        ];
      else
        input.fees.rows = [
          { ...freshInput().fees.rows[0]!, ...change, postedAt: firstAt },
          {
            ...freshInput().fees.rows[0]!,
            id: "extra",
            paymentId: "max",
            amountCents: 1,
            postedAt: secondAt,
          },
        ];
      cases.push({
        id: `${key}-${scope}-overflow-hidden-by-safe-net`,
        input,
        expected: rejected("UNSAFE_CENTS"),
      });
    }
  }
  const negativeOverflow = empty();
  negativeOverflow.charges.rows = [
    {
      id: "old",
      tenantId: "acme",
      currency: "USD",
      amountCents: Number.MAX_SAFE_INTEGER,
    },
  ];
  negativeOverflow.payments.rows = [
    {
      id: "old",
      chargeId: "old",
      status: "captured",
      eventType: "original",
      capturedAt: "2025-12-01T00:00:00Z",
    },
  ];
  negativeOverflow.refunds.rows = [
    {
      ...freshInput().refunds.rows[0]!,
      paymentId: "old",
      amountCents: Number.MAX_SAFE_INTEGER,
      settledAt: "2026-01-01T00:00:00Z",
    },
  ];
  negativeOverflow.fees.rows = [
    {
      ...freshInput().fees.rows[0]!,
      paymentId: "old",
      amountCents: 1,
      postedAt: "2026-01-01T00:00:00Z",
    },
  ];
  cases.push({
    id: "signed-monthly-net-overflow",
    input: negativeOverflow,
    expected: rejected("UNSAFE_CENTS"),
  });
  const grandNegative = structuredClone(negativeOverflow);
  grandNegative.fees.rows[0]!.postedAt = "2026-02-01T00:00:00Z";
  cases.push({
    id: "signed-grand-net-overflow",
    input: grandNegative,
    expected: rejected("UNSAFE_CENTS"),
  });
  // Exact boundary fixture: positive component in Jan and June, independent of old parents.
  const edges = empty();
  edges.charges.rows = [
    { id: "edge", tenantId: "acme", currency: "USD", amountCents: 100 },
  ];
  edges.payments.rows = [
    {
      id: "edge",
      chargeId: "edge",
      eventType: "original",
      status: "captured",
      capturedAt: "2025-12-31T23:30:00-01:00",
    },
  ];
  edges.refunds.rows = [
    {
      ...freshInput().refunds.rows[0]!,
      id: "start",
      paymentId: "edge",
      amountCents: 10,
      settledAt: "2026-01-01T00:00:00Z",
    },
    {
      ...freshInput().refunds.rows[0]!,
      id: "end",
      paymentId: "edge",
      amountCents: 50,
      settledAt: "2026-06-30T23:30:00-01:00",
    },
  ];
  edges.fees.rows = [
    {
      ...freshInput().fees.rows[0]!,
      id: "before",
      paymentId: "edge",
      amountCents: 50,
      postedAt: "2026-01-01T00:30:00+01:00",
    },
    {
      ...freshInput().fees.rows[0]!,
      id: "june",
      paymentId: "edge",
      amountCents: 20,
      postedAt: "2026-07-01T00:30:00+01:00",
    },
  ];
  cases.push({
    id: "utc-inclusive-start-exclusive-end-all-streams",
    input: edges,
    expected: completed({
      points: [
        {
          month: "2026-01",
          capturedCents: 100,
          settledRefundCents: 10,
          postedFeeCents: 0,
          netCents: 90,
        },
        ...zeroValues.points.slice(1, 5),
        {
          month: "2026-06",
          capturedCents: 0,
          settledRefundCents: 0,
          postedFeeCents: 20,
          netCents: -20,
        },
      ],
      totals: {
        capturedCents: 100,
        settledRefundCents: 10,
        postedFeeCents: 20,
        netCents: 70,
      },
    }),
  });
  return cases;
}

export type Calculator = typeof calculateNetReceipts;
type ActualOutcome =
  | {
      kind: "completed";
      values: Values;
      context: Omit<NetReceiptsResult, "points" | "totals">;
    }
  | { kind: "rejected"; code: NetReceiptsIssueCode }
  | { kind: "execution-failure"; message: string };
function execute(calculator: Calculator, input: unknown): ActualOutcome {
  try {
    const { points, totals, ...context } = calculator(
      netReceiptsDefinition,
      input,
    );
    return { kind: "completed", values: { points, totals }, context };
  } catch (error) {
    return error instanceof NetReceiptsCalculationError
      ? rejected(error.code)
      : { kind: "execution-failure", message: String(error) };
  }
}
export function compareCase(
  test: Case,
  calculator: Calculator = calculateNetReceipts,
) {
  const actual = execute(calculator, test.input);
  const assertions: {
    path: string;
    expected: unknown;
    actual: unknown;
    status: "passed" | "failed";
  }[] = [];
  const compare = (path: string, expected: unknown, actual: unknown) => {
    assertions.push({
      path,
      expected,
      actual: actual ?? null,
      status: isDeepStrictEqual(expected, actual) ? "passed" : "failed",
    });
  };
  compare("kind", test.expected.kind, actual.kind);
  if (test.expected.kind === "completed" && actual.kind === "completed") {
    // All harness cases intentionally share the research's fixed reporting window.
    const scope = test.input as NetReceiptsInput;
    const context: Omit<NetReceiptsResult, "points" | "totals"> = {
      metricId: "operational-net-receipts",
      metricVersion: 1,
      asOf: "2026-07-01",
      tenantId: scope.tenantId,
      currency: "USD",
      timezone: "UTC",
      startInclusive: "2026-01-01T00:00:00.000Z",
      endExclusive: "2026-07-01T00:00:00.000Z",
    };
    for (const key of Object.keys(context) as (keyof typeof context)[])
      compare(`context.${key}`, context[key], actual.context[key]);
    compare(
      "points.length",
      test.expected.values.points.length,
      actual.values.points.length,
    );
    for (const [index, point] of test.expected.values.points.entries())
      for (const key of [
        "month",
        "capturedCents",
        "settledRefundCents",
        "postedFeeCents",
        "netCents",
      ] as const)
        compare(
          `points[${index}].${key}`,
          point[key],
          actual.values.points[index]?.[key],
        );
    for (const key of [
      "capturedCents",
      "settledRefundCents",
      "postedFeeCents",
      "netCents",
    ] as const)
      compare(
        `totals.${key}`,
        test.expected.values.totals[key],
        actual.values.totals[key],
      );
  } else if (test.expected.kind === "rejected" && actual.kind === "rejected")
    compare("code", test.expected.code, actual.code);
  return {
    id: test.id,
    expected: test.expected,
    actual,
    assertions,
    status: assertions.every((a) => a.status === "passed")
      ? ("passed" as const)
      : ("failed" as const),
  };
}

export const mutationIds = [
  "refund-in-capture-month",
  "raw-join-fanout",
  "local-date-bucketing",
  "include-pending",
  "clamp-negative",
  "scope-only-payments",
  "drop-old-parent-refund",
] as const;
export type MutationId = (typeof mutationIds)[number];
/** Deliberately incorrect arithmetic variants. Expected values never use these helpers. */
export function incorrectCalculator(mutation: MutationId): Calculator {
  return (definition, input) => {
    const data = netReceiptsInputSchema.parse(input);
    const header = calculateNetReceipts(definition, input);
    const points = netReceiptsPeriod(data.asOf).months.map((month) => ({
      month,
      capturedCents: 0,
      settledRefundCents: 0,
      postedFeeCents: 0,
      netCents: 0,
    }));
    const payments = new Map(data.payments.rows.map((p) => [p.id, p]));
    const charges = new Map(data.charges.rows.map((c) => [c.id, c]));
    const bucket = (at: string) =>
      mutation === "local-date-bucketing"
        ? at.slice(0, 7)
        : new Date(at).toISOString().slice(0, 7);
    for (const p of data.payments.rows) {
      const c = charges.get(p.chargeId)!;
      if (
        c.tenantId !== data.tenantId ||
        p.status !== "captured" ||
        !p.capturedAt
      )
        continue;
      const point = points.find((m) => m.month === bucket(p.capturedAt!));
      const multiplier =
        mutation === "raw-join-fanout"
          ? Math.max(
              1,
              data.refunds.rows.filter((r) => r.paymentId === p.id).length,
            ) *
            Math.max(
              1,
              data.fees.rows.filter((f) => f.paymentId === p.id).length,
            )
          : 1;
      if (point) point.capturedCents += c.amountCents * multiplier;
    }
    for (const rows of [data.refunds.rows, data.fees.rows])
      for (const a of rows) {
        const p = payments.get(a.paymentId)!;
        if (mutation !== "scope-only-payments" && a.tenantId !== data.tenantId)
          continue;
        if (
          mutation !== "include-pending" &&
          a.status !== "settled" &&
          a.status !== "posted"
        )
          continue;
        let at = "settledAt" in a ? a.settledAt : a.postedAt;
        if (mutation === "refund-in-capture-month" && "settledAt" in a)
          at = p.capturedAt;
        if (
          mutation === "drop-old-parent-refund" &&
          "settledAt" in a &&
          !points.some((m) => m.month === bucket(p.capturedAt!))
        )
          continue;
        const point = at
          ? points.find((m) => m.month === bucket(at))
          : undefined;
        if (point) {
          if ("settledAt" in a) point.settledRefundCents += a.amountCents;
          else point.postedFeeCents += a.amountCents;
        }
      }
    for (const p of points) {
      p.netCents = p.capturedCents - p.settledRefundCents - p.postedFeeCents;
      if (mutation === "clamp-negative") p.netCents = Math.max(0, p.netCents);
    }
    const totals = {
      capturedCents: 0,
      settledRefundCents: 0,
      postedFeeCents: 0,
      netCents: 0,
    };
    for (const p of points)
      for (const key of [
        "capturedCents",
        "settledRefundCents",
        "postedFeeCents",
        "netCents",
      ] as const)
        totals[key] += p[key];
    return { ...header, points, totals };
  };
}
