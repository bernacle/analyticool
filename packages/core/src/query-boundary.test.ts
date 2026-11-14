import { describe, expect, it } from "vitest";
import {
  boundedQueryRequestSchema,
  defineDatasetAllowlist,
  describeConnection,
  evaluateRowCap,
  isIssuedQueryPlan,
  issueTenantScope,
  planBoundedQuery,
  QueryBoundaryError,
  syntheticTenancyAllowlist,
  validateConnectionConfig,
  type QueryBoundaryIssueCode,
} from "./index";

// Server-held synthetic membership directory (never client input).
const memberships = [
  { principalId: "user-ana", tenantId: "fictional-acme", role: "analyst" },
  { principalId: "user-vic", tenantId: "fictional-acme", role: "viewer" },
  { principalId: "user-oli", tenantId: "fictional-orbit", role: "analyst" },
] as const;
const acme = () =>
  issueTenantScope(
    { principalId: "user-ana", tenantId: "fictional-acme" },
    memberships,
  );
const range = {
  startInclusive: "2026-01-01T00:00:00Z",
  endExclusive: "2026-07-01T00:00:00Z",
};
const request = (extra: Record<string, unknown> = {}) => ({
  dataset: "refunds",
  fields: ["id", "amountCents"],
  timeRange: range,
  ...extra,
});

function code(
  fn: () => unknown,
): QueryBoundaryIssueCode | "no-error" | "other-error" {
  try {
    fn();
    return "no-error";
  } catch (error) {
    return error instanceof QueryBoundaryError ? error.code : "other-error";
  }
}

describe("server-issued tenant scope", () => {
  it("issues a frozen scope only for a held membership", () => {
    const scope = acme();
    expect(scope).toEqual({
      kind: "tenant-scope",
      principalId: "user-ana",
      tenantId: "fictional-acme",
      role: "analyst",
    });
    expect(Object.isFrozen(scope)).toBe(true);
  });

  it("refuses a tenant-B scope to a principal with only tenant-A membership", () => {
    expect(
      code(() =>
        issueTenantScope(
          { principalId: "user-ana", tenantId: "fictional-orbit" },
          memberships,
        ),
      ),
    ).toBe("NO_TENANT_MEMBERSHIP");
    expect(
      code(() =>
        issueTenantScope(
          { principalId: "user-ana", tenantId: "fictional-orbit" },
          [],
        ),
      ),
    ).toBe("NO_TENANT_MEMBERSHIP");
  });

  it("rejects malformed principals, memberships and conflicting roles", () => {
    expect(
      code(() =>
        issueTenantScope(
          { principalId: "", tenantId: "fictional-acme" },
          memberships,
        ),
      ),
    ).toBe("INVALID_PRINCIPAL");
    expect(
      code(() =>
        issueTenantScope(
          { principalId: "user-ana", tenantId: "fictional-acme' OR 1=1" },
          memberships,
        ),
      ),
    ).toBe("INVALID_PRINCIPAL");
    expect(
      code(() =>
        issueTenantScope(
          { principalId: "user-ana", tenantId: "fictional-acme" },
          [
            {
              principalId: "user-ana",
              tenantId: "fictional-acme",
              role: "owner",
            },
          ],
        ),
      ),
    ).toBe("INVALID_PRINCIPAL");
    expect(
      code(() =>
        issueTenantScope(
          { principalId: "user-ana", tenantId: "fictional-acme" },
          [
            ...memberships,
            {
              principalId: "user-ana",
              tenantId: "fictional-acme",
              role: "viewer",
            },
          ],
        ),
      ),
    ).toBe("AMBIGUOUS_TENANT_MEMBERSHIP");
  });

  it("rejects forged scopes: clones, parsed JSON and literals grant nothing", () => {
    const scope = acme();
    const forgeries = [
      structuredClone(scope),
      JSON.parse(JSON.stringify(scope)),
      { ...scope },
      {
        kind: "tenant-scope",
        principalId: "user-ana",
        tenantId: "fictional-orbit",
        role: "analyst",
      },
      Object.freeze({ ...scope, tenantId: "fictional-orbit" }),
    ];
    for (const forged of forgeries)
      expect(code(() => planBoundedQuery(forged, request()))).toBe(
        "UNTRUSTED_SCOPE",
      );
    expect(code(() => planBoundedQuery(scope, request()))).toBe("no-error");
  });

  it("enforces dataset roles from the server-held membership", () => {
    const viewer = issueTenantScope(
      { principalId: "user-vic", tenantId: "fictional-acme" },
      memberships,
    );
    const fees = request({ dataset: "processingFees" });
    expect(code(() => planBoundedQuery(viewer, fees))).toBe("ROLE_NOT_ALLOWED");
    expect(code(() => planBoundedQuery(acme(), fees))).toBe("no-error");
  });
});

describe("strict request schema", () => {
  it.each([
    "tenantId",
    "tenant",
    "sql",
    "table",
    "view",
    "where",
    "orderBy",
    "timeoutMs",
  ])("rejects the client-supplied %s field", (key) => {
    const forged = request({
      [key]: key === "tenantId" ? "fictional-orbit" : "x",
    });
    expect(boundedQueryRequestSchema.safeParse(forged).success).toBe(false);
    expect(code(() => planBoundedQuery(acme(), forged))).toBe(
      "INVALID_REQUEST",
    );
  });

  it("rejects extra keys inside filters and time ranges", () => {
    expect(
      code(() =>
        planBoundedQuery(
          acme(),
          request({
            filters: [{ field: "id", op: "eq", value: "x", sql: "1=1" }],
          }),
        ),
      ),
    ).toBe("INVALID_REQUEST");
    expect(
      code(() =>
        planBoundedQuery(
          acme(),
          request({ timeRange: { ...range, tenantId: "fictional-orbit" } }),
        ),
      ),
    ).toBe("INVALID_REQUEST");
    expect(
      code(() =>
        planBoundedQuery(
          acme(),
          request({ filters: [{ field: "id", op: "like", value: "%" }] }),
        ),
      ),
    ).toBe("INVALID_REQUEST");
  });
});

describe("dataset and field allowlist", () => {
  it("rejects unknown datasets, including base tables and catalog names", () => {
    for (const dataset of [
      "invoices",
      "analyticool_private.charges",
      "pg_authid",
      "__proto__",
      "constructor",
      "charges; DROP TABLE charges",
    ])
      expect(code(() => planBoundedQuery(acme(), request({ dataset })))).toBe(
        "UNKNOWN_DATASET",
      );
  });

  it("rejects fields outside the dataset allowlist and never places them in SQL", () => {
    const hostile = [
      "tenantId",
      "tenant_id",
      'id" FROM analyticool_private.charges --',
      "id; DELETE FROM refunds",
      "toString",
      "__proto__",
    ];
    for (const name of hostile) {
      expect(
        code(() => planBoundedQuery(acme(), request({ fields: ["id", name] }))),
      ).toBe("UNKNOWN_FIELD");
      expect(
        code(() =>
          planBoundedQuery(
            acme(),
            request({ filters: [{ field: name, op: "eq", value: "x" }] }),
          ),
        ),
      ).toBe("UNKNOWN_FIELD");
    }
  });

  it("rejects non-filterable fields and mistyped filter values", () => {
    expect(
      code(() =>
        planBoundedQuery(
          acme(),
          request({ filters: [{ field: "amountCents", op: "eq", value: 1 }] }),
        ),
      ),
    ).toBe("FIELD_NOT_FILTERABLE");
    expect(
      code(() =>
        planBoundedQuery(
          acme(),
          request({ filters: [{ field: "id", op: "eq", value: 7 }] }),
        ),
      ),
    ).toBe("INVALID_FILTER_VALUE");
    expect(
      code(() => planBoundedQuery(acme(), request({ fields: ["id", "id"] }))),
    ).toBe("INVALID_REQUEST");
  });

  it("only plans with an allowlist registered by defineDatasetAllowlist", () => {
    const copy = JSON.parse(JSON.stringify(syntheticTenancyAllowlist));
    expect(code(() => planBoundedQuery(acme(), request(), copy))).toBe(
      "UNTRUSTED_ALLOWLIST",
    );
    expect(code(() => defineDatasetAllowlist(copy))).toBe("no-error");
  });

  it("rejects allowlists with unsafe identifiers or inconsistent specs", () => {
    const base = JSON.parse(JSON.stringify(syntheticTenancyAllowlist));
    const variants: ((a: typeof base) => void)[] = [
      (a) => (a.datasets.refunds.view.name = 'refunds" ; DROP TABLE x; --'),
      (a) => (a.datasets.refunds.view.schema = "Public"),
      (a) => (a.datasets.refunds.fields.id.column = "id; --"),
      (a) => (a.datasets.refunds.timeField = "amountCents"),
      (a) => (a.datasets.refunds.orderBy = ["missing"]),
      (a) => (a.datasets.refunds.maxRows = 0),
      (a) => (a.datasets.refunds.timeoutMs = 600_000),
      (a) => (a.datasets.refunds.sql = "SELECT 1"),
      (a) => (a.tenantSetting = "role"),
      (a) => (a.datasets.refunds.fields.settledAt.filterable = true),
    ];
    for (const mutate of variants) {
      const candidate = JSON.parse(JSON.stringify(base));
      mutate(candidate);
      expect(code(() => defineDatasetAllowlist(candidate))).toBe(
        "INVALID_ALLOWLIST",
      );
    }
  });
});

describe("template-only parameterized planning", () => {
  it("produces quoted allowlisted identifiers, parameters for every value and LIMIT cap+1", () => {
    const plan = planBoundedQuery(
      acme(),
      request({
        fields: ["id", "paymentId", "amountCents"],
        filters: [
          { field: "status", op: "eq", value: "settled' OR '1'='1" },
          {
            field: "paymentId",
            op: "in",
            values: ["acme-pay-1", "orbit-pay-1"],
          },
        ],
        limit: 25,
      }),
    );
    expect(plan.text).toBe(
      'SELECT "id" AS "id", "payment_id" AS "paymentId", "amount_cents" AS "amountCents" ' +
        'FROM "analyticool_api"."refunds" ' +
        'WHERE "settled_at" >= $1::timestamptz AND "settled_at" < $2::timestamptz ' +
        'AND "status" = $3::text AND "payment_id" IN ($4::text, $5::text) ' +
        'ORDER BY "settled_at", "id" LIMIT $6::bigint',
    );
    expect(plan.values).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      "settled' OR '1'='1",
      "acme-pay-1",
      "orbit-pay-1",
      26,
    ]);
    expect(plan.rowCap).toBe(25);
    expect(plan.tenant).toEqual({
      setting: "analyticool.tenant_id",
      value: "fictional-acme",
    });
    expect(plan.text).not.toContain("fictional-acme");
    expect(plan.text).not.toContain("settled'");
    expect(plan.text).not.toMatch(/[;\\]/);
    expect(plan.timeoutMs).toBe(5_000);
    expect(plan.lockTimeoutMs).toBeLessThanOrEqual(plan.timeoutMs);
    expect(Object.isFrozen(plan) && Object.isFrozen(plan.values)).toBe(true);
    expect(isIssuedQueryPlan(plan)).toBe(true);
    expect(isIssuedQueryPlan({ ...plan })).toBe(false);
    expect(isIssuedQueryPlan(structuredClone(plan))).toBe(false);
  });

  it("uses the dataset maximum as the default cap and timeout ceiling", () => {
    const plan = planBoundedQuery(acme(), request());
    expect(plan.rowCap).toBe(10_000);
    expect(plan.values.at(-1)).toBe(10_001);
    expect(plan.timeoutMs).toBeLessThanOrEqual(
      syntheticTenancyAllowlist.datasets.refunds!.timeoutMs,
    );
  });

  it("normalizes offsets to UTC and is deterministic", () => {
    const input = request({
      timeRange: {
        startInclusive: "2025-12-31T22:00:00-02:00",
        endExclusive: "2026-07-01T00:00:00+00:00",
      },
    });
    const a = planBoundedQuery(acme(), input);
    const b = planBoundedQuery(acme(), structuredClone(input));
    expect(a.values[0]).toBe("2026-01-01T00:00:00.000Z");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).not.toBe(b);
  });

  it("rejects limits above the dataset maximum and invalid or oversized ranges", () => {
    expect(
      code(() => planBoundedQuery(acme(), request({ limit: 10_001 }))),
    ).toBe("ROW_LIMIT_TOO_LARGE");
    expect(code(() => planBoundedQuery(acme(), request({ limit: 0 })))).toBe(
      "INVALID_REQUEST",
    );
    expect(
      code(() =>
        planBoundedQuery(
          acme(),
          request({
            timeRange: {
              startInclusive: range.endExclusive,
              endExclusive: range.startInclusive,
            },
          }),
        ),
      ),
    ).toBe("INVALID_TIME_RANGE");
    expect(
      code(() =>
        planBoundedQuery(
          acme(),
          request({
            timeRange: {
              startInclusive: "2024-01-01T00:00:00Z",
              endExclusive: "2026-01-01T00:00:00Z",
            },
          }),
        ),
      ),
    ).toBe("TIME_RANGE_TOO_LARGE");
    expect(
      code(() =>
        planBoundedQuery(
          acme(),
          request({
            timeRange: { startInclusive: "yesterday", endExclusive: "now" },
          }),
        ),
      ),
    ).toBe("INVALID_REQUEST");
  });
});

describe("row cap", () => {
  it("blocks rather than truncates when rows exceed the cap", () => {
    expect(evaluateRowCap([1, 2, 3], 2)).toEqual({
      status: "blocked",
      code: "ROW_CAP_EXCEEDED",
      rowCap: 2,
    });
    expect(evaluateRowCap([1, 2], 2)).toEqual({
      status: "complete",
      rows: [1, 2],
    });
    expect(evaluateRowCap([], 2)).toEqual({ status: "complete", rows: [] });
    expect(() => evaluateRowCap([], 0)).toThrow(RangeError);
  });
});

describe("connection settings", () => {
  const password = "synthetic-s3cret-do-not-echo";
  const production = {
    mode: "production",
    host: "db.example.invalid",
    port: 5432,
    database: "analytics",
    user: "analyticool_app",
    password,
    sslmode: "verify-full",
  } as const;

  it("accepts verify-full TLS for a non-privileged role", () => {
    const config = validateConnectionConfig(production);
    expect(Object.isFrozen(config)).toBe(true);
    expect(describeConnection(config)).toBe(
      "postgresql://analyticool_app:***@db.example.invalid:5432/analytics?sslmode=verify-full",
    );
  });

  it.each(["disable", "allow", "prefer", "require", "verify-ca"])(
    "rejects sslmode=%s outside local-test mode",
    (sslmode) => {
      expect(
        code(() => validateConnectionConfig({ ...production, sslmode })),
      ).toBe("INSECURE_CONNECTION");
    },
  );

  it("only allows local-test mode on loopback hosts", () => {
    const local = { ...production, mode: "local-test", sslmode: "disable" };
    expect(
      code(() => validateConnectionConfig({ ...local, host: "localhost" })),
    ).toBe("no-error");
    expect(
      code(() => validateConnectionConfig({ ...local, host: "127.0.0.1" })),
    ).toBe("no-error");
    expect(code(() => validateConnectionConfig(local))).toBe(
      "INSECURE_CONNECTION",
    );
  });

  it.each([
    "postgres",
    "Postgres",
    "rdsadmin",
    "supabase_admin",
    "analyticool_owner",
    "billing_owner",
  ])("rejects the privileged role %s", (user) => {
    expect(code(() => validateConnectionConfig({ ...production, user }))).toBe(
      "PRIVILEGED_ROLE",
    );
  });

  it("never echoes the password or host in errors", () => {
    const attempts: unknown[] = [
      { ...production, sslmode: "disable" },
      { ...production, user: "postgres" },
      { ...production, port: "5432" },
      { ...production, extra: password },
      { ...production, password: "" },
    ];
    for (const attempt of attempts) {
      try {
        validateConnectionConfig(attempt);
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(QueryBoundaryError);
        const text = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack}`;
        expect(text).not.toContain(password);
        expect(text).not.toContain("db.example.invalid");
      }
    }
  });
});
