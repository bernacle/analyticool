import { describe, expect, it } from "vitest";
import {
  issueTenantScope,
  planBoundedQuery,
} from "../../packages/core/src/query-boundary";
import { executeBoundedQuery, executorScript } from "./prototype";

// Runs without a database: checks what the executor would send to psql.
const scope = issueTenantScope(
  { principalId: "user-ana", tenantId: "fictional-acme" },
  [{ principalId: "user-ana", tenantId: "fictional-acme", role: "analyst" }],
);
const plan = planBoundedQuery(scope, {
  dataset: "refunds",
  fields: ["id", "amountCents"],
  timeRange: {
    startInclusive: "2026-01-01T00:00:00Z",
    endExclusive: "2026-07-01T00:00:00Z",
  },
  filters: [{ field: "status", op: "eq", value: "settled'; DROP TABLE x; --" }],
  limit: 5,
});

describe("reference executor script", () => {
  it("wraps the plan in one read-only transaction with local limits", () => {
    const script = executorScript(plan);
    const lines = script.trim().split("\n");
    expect(lines[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;",
    );
    expect(lines).toContain("SET LOCAL statement_timeout = 5000;");
    expect(lines).toContain("SET LOCAL lock_timeout = 1000;");
    expect(lines).toContain(
      "SET LOCAL idle_in_transaction_session_timeout = 6000;",
    );
    expect(lines.at(-1)).toBe("COMMIT;");
    expect(script).toContain(
      "set_config('analyticool.tenant_id', $1, true) IS NOT NULL \\bind :tenant \\g",
    );
    expect(script).toContain(
      `FROM (${plan.text}) AS r \\bind :p1 :p2 :p3 :p4 \\g`,
    );
  });

  it("never inlines the tenant ID or request values", () => {
    const script = executorScript(plan);
    expect(script).not.toContain("fictional-acme");
    expect(script).not.toContain("DROP TABLE");
    expect(script).not.toContain("2026-01-01");
  });

  it("refuses untrusted plans before any connection is attempted", async () => {
    expect(await executeBoundedQuery({}, { ...plan })).toEqual({
      status: "failed",
      code: "UNTRUSTED_PLAN",
    });
    expect(await executeBoundedQuery({ mode: "production" }, plan)).toEqual({
      status: "failed",
      code: "CONNECTION_REJECTED",
    });
  });

  const secret = "synthetic-pass-do-not-echo";
  const config = {
    mode: "local-test",
    host: "localhost",
    port: 1,
    database: "analytics",
    user: "analyticool_app",
    password: secret,
    sslmode: "disable",
  } as const;
  const neverRun = () => {
    throw new Error("runner must not be called");
  };

  it("rejects socket hosts and NUL credentials before spawning, without echoing them", async () => {
    for (const bad of [
      { ...config, mode: "production", sslmode: "verify-full", host: "/tmp" },
      { ...config, host: "/tmp" },
      { ...config, password: `${secret}\u0000` },
      { ...config, user: "analyticool_app\u0000" },
    ]) {
      const outcome = await executeBoundedQuery(bad, plan, neverRun);
      expect(outcome).toEqual({
        status: "failed",
        code: "CONNECTION_REJECTED",
      });
      expect(JSON.stringify(outcome)).not.toContain(secret);
    }
  });

  it("contains runner exceptions as a generic code", async () => {
    const leaky = async () => {
      throw new TypeError(`spawn failed: PGPASSWORD=${secret}`);
    };
    const syncLeaky = () => {
      throw new TypeError(`spawn failed: PGPASSWORD=${secret}`);
    };
    for (const runner of [leaky, syncLeaky]) {
      const outcome = await executeBoundedQuery(config, plan, runner);
      expect(outcome).toEqual({ status: "failed", code: "QUERY_FAILED" });
      expect(JSON.stringify(outcome)).not.toContain(secret);
    }
  });

  it("a missing psql binary yields a generic code, not an exception", async () => {
    const previous = process.env.ANALYTICOOL_PSQL;
    process.env.ANALYTICOOL_PSQL = "/nonexistent/analyticool-psql";
    try {
      const outcome = await executeBoundedQuery(config, plan);
      expect(outcome).toEqual({ status: "failed", code: "CONNECTION_FAILED" });
      expect(JSON.stringify(outcome)).not.toContain(secret);
    } finally {
      if (previous === undefined) delete process.env.ANALYTICOOL_PSQL;
      else process.env.ANALYTICOOL_PSQL = previous;
    }
  });
});
