import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  calculateNetReceipts,
  monthlyRevenueResultSchema,
  netReceiptsDefinition,
  netReceiptsDefinitionSchema,
  netReceiptsInputSchema,
  netReceiptsPeriod,
  netReceiptsResultSchema,
} from "./index";
import oracle from "../../../verification/net-receipts/bru-482.expected.json";
import {
  compareCase,
  freshInput,
  incorrectCalculator,
  mutationIds,
  verificationCases,
} from "../../../verification/net-receipts/suite";
import {
  buildEvidence,
  digestBytes,
  snapshotDigest,
} from "../../../verification/net-receipts/evidence";

describe("independent net receipts fixture assertions", () => {
  for (const test of verificationCases()) {
    it(test.id, () => {
      const comparison = compareCase(test);
      expect(
        comparison.assertions.filter((a) => a.status === "failed"),
      ).toEqual([]);
      expect(comparison.status).toBe("passed");
    });
  }
  for (const mutation of mutationIds) {
    it(`independent expectations catch incorrect variant: ${mutation}`, () => {
      const comparison = compareCase(
        verificationCases()[0]!,
        incorrectCalculator(mutation),
      );
      expect(comparison.actual.kind).toBe("completed");
      expect(comparison.status).toBe("failed");
      expect(
        comparison.assertions.some(
          (a) => a.path.startsWith("points[") && a.status === "failed",
        ),
      ).toBe(true);
    });
  }
  it("does not treat an unexpected error or wrong rejection code as a passed rejection", () => {
    const test = verificationCases().find(
      (c) => c.id === "refunds-unknown-parent",
    )!;
    expect(
      compareCase(test, () => {
        throw new Error("loader failed");
      }).status,
    ).toBe("failed");
    expect(
      compareCase(test, (_d, i) =>
        calculateNetReceipts(netReceiptsDefinition, {
          ...(i as object),
          payments: undefined,
        }),
      ).status,
    ).toBe("failed");
  });
});

describe("net receipts contracts and compatibility", () => {
  it("accepts only the closed policy with strict fields", () => {
    expect(netReceiptsDefinitionSchema.parse(netReceiptsDefinition)).toEqual(
      netReceiptsDefinition,
    );
    for (const change of [
      { version: 2 },
      { calculation: "sum-paid-invoices" },
      { currency: "EUR" },
      { timezone: "America/New_York" },
      { sql: "SELECT 1" },
    ]) {
      expect(
        netReceiptsDefinitionSchema.safeParse({
          ...netReceiptsDefinition,
          ...change,
        }).success,
      ).toBe(false);
      expect(() =>
        calculateNetReceipts(
          {
            ...netReceiptsDefinition,
            ...change,
          } as typeof netReceiptsDefinition,
          freshInput(),
        ),
      ).toThrow(/INVALID_INPUT/);
    }
  });
  it("supports signed net months while collected-revenue v1 still rejects them", () => {
    const result = calculateNetReceipts(netReceiptsDefinition, freshInput());
    expect(result.points).toEqual(oracle.points);
    expect(result.totals).toEqual(oracle.totals);
    expect(netReceiptsResultSchema.parse(result)).toEqual(result);
    expect(
      monthlyRevenueResultSchema.safeParse({
        metricId: "monthly-revenue",
        metricVersion: 1,
        asOf: result.asOf,
        currency: "USD",
        timezone: "UTC",
        points: result.points.map((p) => ({
          month: p.month,
          valueCents: p.netCents,
        })),
      }).success,
    ).toBe(false);
  });
  it("rejects component, monthly, grand-total and period inconsistencies", () => {
    const result = calculateNetReceipts(netReceiptsDefinition, freshInput());
    const invalid = [
      { ...result, totals: { ...result.totals, netCents: 51651 } },
      {
        ...result,
        totals: { ...result.totals, capturedCents: 60001, netCents: 51651 },
      },
      {
        ...result,
        points: result.points.map((p, i) =>
          i === 0 ? { ...p, capturedCents: 10001 } : p,
        ),
      },
      {
        ...result,
        points: result.points.map((p, i) => ({
          ...p,
          netCents: p.netCents + (i === 0 ? 1 : i === 1 ? -1 : 0),
        })),
      },
      { ...result, points: [...result.points].reverse() },
      { ...result, points: result.points.slice(1) },
      {
        ...result,
        points: result.points.map((p) => ({ ...p, capturedCents: 0.5 })),
      },
      {
        ...result,
        points: result.points.map((p) => ({ ...p, capturedCents: Infinity })),
      },
      {
        ...result,
        points: result.points.map((p) => ({
          ...p,
          capturedCents: Number.MAX_SAFE_INTEGER + 1,
        })),
      },
      { ...result, asOf: "2026-08-01" },
      { ...result, asOf: "not-a-date" },
      { ...result, startInclusive: "2026-01-02T00:00:00.000Z" },
      { ...result, endExclusive: "2026-07-02T00:00:00.000Z" },
      { ...result, verified: true },
    ];
    for (const value of invalid)
      expect(netReceiptsResultSchema.safeParse(value).success).toBe(false);
  });
  it("rejects missing timestamps, malformed dates, null amounts, unknown statuses and extra fields", () => {
    for (const [key, field] of [
      ["payments", "capturedAt"],
      ["refunds", "settledAt"],
      ["fees", "postedAt"],
    ] as const) {
      for (const timestamp of [
        null,
        "2026-02-30T00:00:00Z",
        "2026-01-01T00:00:00+99:99",
        "2026-01-01T00:00:00",
      ]) {
        const input = freshInput();
        Object.assign(input[key].rows[0]!, { [field]: timestamp });
        expect(() =>
          calculateNetReceipts(netReceiptsDefinition, input),
        ).toThrow(/INVALID_INPUT/);
      }
      for (const change of [
        { status: "reversed" },
        { eventType: "credit" },
        { unexpected: 1 },
      ]) {
        const input = freshInput();
        Object.assign(input[key].rows[0]!, change);
        expect(netReceiptsInputSchema.safeParse(input).success).toBe(false);
      }
    }
    const nullAmount = freshInput();
    Object.assign(nullAmount.charges.rows[0]!, { amountCents: null });
    expect(() =>
      calculateNetReceipts(netReceiptsDefinition, nullAmount),
    ).toThrow(/INVALID_INPUT/);
    for (const asOf of ["2026-02-30", "2026-13-01", "0000-01-01", "0001-01-01"])
      expect(() =>
        calculateNetReceipts(netReceiptsDefinition, { ...freshInput(), asOf }),
      ).toThrow(/INVALID_INPUT/);
  });
  it("handles leap day, year rollover and four-digit early years without Date's 1900 coercion", () => {
    expect(netReceiptsPeriod("2026-02-28").months).toEqual([
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
    expect(netReceiptsPeriod("0001-07-01").months).toEqual([
      "0001-01",
      "0001-02",
      "0001-03",
      "0001-04",
      "0001-05",
      "0001-06",
    ]);
    const input = freshInput();
    input.asOf = "2024-03-01";
    input.charges.rows = input.charges.rows.filter((c) => c.id === "c1");
    input.payments.rows = [
      { ...input.payments.rows[0]!, capturedAt: "2024-02-29T23:59:59Z" },
    ];
    input.refunds.rows = [];
    input.fees.rows = [];
    expect(
      calculateNetReceipts(netReceiptsDefinition, input).points[5],
    ).toEqual({
      month: "2024-02",
      capturedCents: 10000,
      settledRefundCents: 0,
      postedFeeCents: 0,
      netCents: 10000,
    });
  });
  it("accepts the exact safe-integer boundary", () => {
    const input = freshInput();
    input.payments.rows = [input.payments.rows[0]!];
    input.refunds.rows = [];
    input.fees.rows = [];
    input.charges.rows[0]!.amountCents = Number.MAX_SAFE_INTEGER;
    expect(
      calculateNetReceipts(netReceiptsDefinition, input).totals.netCents,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("never mutates frozen caller inputs and preserves previous late-event snapshots", () => {
    const input = freshInput();
    const before = JSON.stringify(input);
    for (const key of ["charges", "payments", "refunds", "fees"] as const) {
      input[key].rows.forEach(Object.freeze);
      Object.freeze(input[key].rows);
      Object.freeze(input[key]);
    }
    Object.freeze(input);
    const first = calculateNetReceipts(netReceiptsDefinition, input);
    expect(calculateNetReceipts(netReceiptsDefinition, input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
    const later = freshInput();
    later.refunds.rows.push({
      ...later.refunds.rows[0]!,
      id: "late",
      amountCents: 1,
    });
    expect(
      calculateNetReceipts(netReceiptsDefinition, later).totals.netCents,
    ).toBe(51649);
    expect(first.totals.netCents).toBe(51650);
    expect(snapshotDigest(later)).not.toBe(snapshotDigest(input));
  });
});

describe("bounded verification evidence", () => {
  it("hashes exact bytes and schema-ordered snapshots deterministically", () => {
    expect(digestBytes("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const input = freshInput();
    const digest = snapshotDigest(input);
    expect(digest).toBe(
      "sha256:a73302f0083ff4a4e8cbd8ba65c1d0c0eb556838141b3ffa0bf71f3dec7dfea4",
    );
    expect(digestBytes(JSON.stringify(netReceiptsDefinition))).toBe(
      "sha256:5e43fd2494bf230380dcd240bcd3f08d56e9e68cf6028d07c997f33521c587f7",
    );
    for (const key of ["charges", "payments", "refunds", "fees"] as const)
      input[key].rows.reverse();
    expect(snapshotDigest(input)).toBe(digest);
    input.fees.rows[0]!.amountCents += 1;
    expect(snapshotDigest(input)).not.toBe(digest);
    input.fees.rows.push({ ...input.fees.rows[0]! });
    expect(() => snapshotDigest(input)).toThrow(/Duplicate/);
  });
  it("produces repeatable scoped evidence with real failures for every mutation", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const report = buildEvidence(root);
    expect(buildEvidence(root)).toEqual(report);
    expect(report.status).toBe("passed");
    expect(report.statement).toBe(
      "Synthetic fixture checks passed. Production data has not been verified.",
    );
    expect(report.cases.length).toBe(verificationCases().length);
    expect(
      report.mutations.every((m) => m.detected && m.status === "failed"),
    ).toBe(true);
    expect(report.definition.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.scope.productionFreshness).toBe("unknown");
    expect(report.scope.sourceCompleteness).toBe("caller-declared-only");
  });
});
