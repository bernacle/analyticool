import { describe, expect, it } from "vitest";
import {
  calculateMonthlyRevenue,
  invoiceSchema,
  monthlyRevenueDefinition,
  monthlyRevenueDefinitionSchema,
  monthlyRevenueResultSchema,
  type Invoice,
} from "./index";

const paid = (
  id: string,
  amountCents: number,
  paidAt = "2026-01-15T12:00:00Z",
): Invoice => ({
  id,
  amountCents,
  paidAt,
  currency: "USD",
  status: "paid",
});
const calculate = (invoices: unknown[], asOf = "2026-07-15") =>
  calculateMonthlyRevenue(monthlyRevenueDefinition, { invoices, asOf });

describe("monthly revenue contract", () => {
  it("validates the versioned definition and rejects unsupported logic and extra fields", () => {
    expect(
      monthlyRevenueDefinitionSchema.parse(monthlyRevenueDefinition),
    ).toEqual(monthlyRevenueDefinition);
    for (const change of [
      { version: 2 },
      { calculation: "arbitrary-sql" },
      { sql: "SELECT 1" },
    ]) {
      expect(
        monthlyRevenueDefinitionSchema.safeParse({
          ...monthlyRevenueDefinition,
          ...change,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects invalid amounts, currencies, timestamps, and inconsistent payment status", () => {
    for (const change of [
      { amountCents: -1 },
      { amountCents: 0.5 },
      { amountCents: Number.MAX_SAFE_INTEGER + 1 },
      { currency: "EUR" },
      { paidAt: "2026-02-30T00:00:00Z" },
      { paidAt: "2026-01-01T00:00:00+99:99" },
      { paidAt: null },
      { status: "open" },
    ]) {
      expect(
        invoiceSchema.safeParse({ ...paid("a", 100), ...change }).success,
      ).toBe(false);
    }
    expect(() => calculate([], "not-a-date")).toThrow();
  });

  it("rejects malformed results including duplicate, unordered, missing, and misaligned months", () => {
    const result = calculate([]);
    for (const asOf of ["not-a-date", "2026-02-30", "2026-13-01"]) {
      expect(
        monthlyRevenueResultSchema.safeParse({ ...result, asOf }).success,
      ).toBe(false);
    }
    const points = result.points.map((point) => ({ ...point }));
    points[0] = { month: "2026-02", valueCents: 0 };
    expect(
      monthlyRevenueResultSchema.safeParse({ ...result, points }).success,
    ).toBe(false);
    expect(
      monthlyRevenueResultSchema.safeParse({
        ...result,
        points: [...result.points].reverse(),
      }).success,
    ).toBe(false);
    expect(
      monthlyRevenueResultSchema.safeParse({
        ...result,
        points: result.points.slice(1),
      }).success,
    ).toBe(false);
    expect(
      monthlyRevenueResultSchema.safeParse({ ...result, asOf: "2026-08-01" })
        .success,
    ).toBe(false);
  });
});

describe("monthly collected revenue", () => {
  it("sums integer cents, excludes non-paid invoices, and fills empty months", () => {
    const result = calculate([
      paid("a", 101),
      paid("b", 202),
      paid("c", 500, "2026-06-30T23:59:59Z"),
      { ...paid("refund", 900), status: "refunded" },
      { ...paid("open", 800), status: "open", paidAt: null },
      { ...paid("void", 700), status: "void", paidAt: null },
    ]);
    expect(result.points).toEqual([
      { month: "2026-01", valueCents: 303 },
      { month: "2026-02", valueCents: 0 },
      { month: "2026-03", valueCents: 0 },
      { month: "2026-04", valueCents: 0 },
      { month: "2026-05", valueCents: 0 },
      { month: "2026-06", valueCents: 500 },
    ]);
    expect(result).toMatchObject({
      metricId: "monthly-revenue",
      metricVersion: 1,
      currency: "USD",
      timezone: "UTC",
    });
  });

  it("uses inclusive start and exclusive end boundaries in UTC, including timestamp offsets", () => {
    const result = calculate([
      paid("before", 1, "2025-12-31T23:59:59Z"),
      paid("start", 10, "2026-01-01T00:00:00Z"),
      paid("offset", 20, "2025-12-31T23:30:00-01:00"),
      paid("end", 30, "2026-06-30T23:59:59Z"),
      paid("outside-offset", 40, "2026-06-30T23:30:00-01:00"),
      paid("current", 50, "2026-07-01T00:00:00Z"),
      paid("future", 60, "2026-08-01T00:00:00Z"),
    ]);
    expect(result.points[0]?.valueCents).toBe(30);
    expect(result.points[5]?.valueCents).toBe(30);
  });

  it("handles year rollover and leap day", () => {
    expect(calculate([], "2026-02-01").points.map((p) => p.month)).toEqual([
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
    expect(
      calculate([paid("leap", 99, "2024-02-29T23:59:59Z")], "2024-03-01")
        .points[5]?.valueCents,
    ).toBe(99);
  });

  it("rejects duplicates and overflow rather than silently double-counting or rounding", () => {
    expect(() => calculate([paid("same", 100), paid("same", 100)])).toThrow(
      /unique/,
    );
    expect(() =>
      calculate([paid("a", Number.MAX_SAFE_INTEGER), paid("b", 1)]),
    ).toThrow(RangeError);
  });

  it("is deterministic and does not mutate the supplied records", () => {
    const invoices = Object.freeze([Object.freeze(paid("a", 100))]);
    const input = { invoices, asOf: "2026-07-01" };
    expect(calculateMonthlyRevenue(monthlyRevenueDefinition, input)).toEqual(
      calculateMonthlyRevenue(monthlyRevenueDefinition, input),
    );
    expect(invoices[0]?.amountCents).toBe(100);
  });
});
