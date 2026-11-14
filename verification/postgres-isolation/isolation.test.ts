import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defineDatasetAllowlist,
  issueTenantScope,
  planBoundedQuery,
  syntheticTenancyAllowlist,
  type ConnectionConfig,
  type TenantScope,
} from "../../packages/core/src/query-boundary";
import { executeBoundedQuery, type ExecutionOutcome } from "./prototype";
import { runPsql, type PsqlTarget } from "./psql";

/**
 * Adversarial BRU-461 tenant-isolation suite against a real, disposable
 * PostgreSQL 16+ cluster. Skipped unless ANALYTICOOL_PG_TEST_ADMIN_URL points
 * at a superuser on a throwaway cluster (roles are cluster-wide and are
 * dropped/recreated). Bootstrap runs as admin; every probe runs as the
 * restricted analyticool_app role.
 */
const adminUrl = process.env.ANALYTICOOL_PG_TEST_ADMIN_URL;
const sql = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const ACME_IDS = {
  charges: ["acme-ch-1", "acme-ch-2", "acme-ch-3"],
  payments: ["acme-pay-1", "acme-pay-2", "acme-pay-3"],
  refunds: ["acme-ref-1", "acme-ref-2", "acme-ref-cross"],
  processingFees: ["acme-fee-1", "acme-fee-2"],
} as const;
const ORBIT_IDS = {
  charges: ["orbit-ch-1", "orbit-ch-2"],
  payments: ["orbit-pay-1", "orbit-pay-2"],
  refunds: ["orbit-ref-1", "orbit-ref-reverse"],
  processingFees: ["orbit-fee-1"],
} as const;
const ORBIT_SENTINEL_AMOUNTS = [999999, 424242, 12345, 13579, 7777];
const ACME_AMOUNTS = [10000, 20000, 30000, 1000, 500, 4120, 300, 50];
const DATASETS = Object.keys(ACME_IDS) as (keyof typeof ACME_IDS)[];
const VIEWS = ["charges", "payments", "refunds", "processing_fees"];
// read_only_sql_transaction, insufficient_privilege, wrong_object_type,
// object_not_in_prerequisite_state, feature_not_supported (non-updatable view).
const WRITE_DENIED = ["25006", "42501", "42809", "55000", "0A000"];

const memberships = [
  { principalId: "user-ana", tenantId: "fictional-acme", role: "analyst" },
  { principalId: "user-oli", tenantId: "fictional-orbit", role: "analyst" },
] as const;
const timeRange = {
  startInclusive: "2026-01-01T00:00:00Z",
  endExclusive: "2026-12-31T00:00:00Z",
};

function adminTargetFrom(url: string): PsqlTarget {
  const parsed = new URL(url);
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ""),
    port: Number(parsed.port || 5432),
    database: decodeURIComponent(parsed.pathname.slice(1)) || "postgres",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    sslmode: parsed.searchParams.get("sslmode") ?? "prefer",
  };
}
const lines = (stdout: string) =>
  stdout.split("\n").filter((line) => line.length > 0);

describe.skipIf(!adminUrl)("PostgreSQL tenant isolation (BRU-461)", () => {
  const adminTarget = adminTargetFrom(
    adminUrl ?? "postgres://invalid@localhost/x",
  );
  const database = `analyticool_isolation_${randomBytes(6).toString("hex")}`;
  const appPassword = `synthetic-${randomBytes(18).toString("hex")}`;
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(adminTarget.host);
  const appConfig: ConnectionConfig = {
    mode: loopback ? "local-test" : "production",
    host: adminTarget.host,
    port: adminTarget.port,
    database,
    user: "analyticool_app",
    password: appPassword,
    sslmode: adminTarget.sslmode as ConnectionConfig["sslmode"],
  };
  const appTarget: PsqlTarget = { ...appConfig };
  // Test-only server allowlist: a tight cap, the verification-only slow view,
  // and a deliberately misconfigured entry pointing at a base table.
  const testAllowlist = defineDatasetAllowlist({
    ...JSON.parse(JSON.stringify(syntheticTenancyAllowlist)),
    datasets: {
      cappedCharges: {
        ...syntheticTenancyAllowlist.datasets.charges,
        maxRows: 2,
      },
      slowCharges: {
        view: { schema: "analyticool_api", name: "verification_slow_charges" },
        fields: {
          id: { column: "id", type: "text", filterable: true },
          createdAt: {
            column: "created_at",
            type: "timestamp",
            filterable: false,
          },
        },
        timeField: "createdAt",
        orderBy: ["createdAt", "id"],
        allowedRoles: ["analyst"],
        maxRows: 10,
        timeoutMs: 200,
        maxRangeDays: 366,
      },
      misconfiguredBaseTable: {
        ...syntheticTenancyAllowlist.datasets.charges,
        view: { schema: "analyticool_private", name: "charges" },
      },
    },
  });
  let acme: TenantScope;
  let orbit: TenantScope;

  async function admin(
    script: string,
    db = database,
    variables: Record<string, string> = {},
  ): Promise<string[][]> {
    const run = await runPsql({ ...adminTarget, database: db }, script, {
      variables,
      timeoutMs: 120_000,
      verbose: true,
    });
    if (run.exitCode !== 0)
      throw new Error(
        `Admin bootstrap failed (exit ${run.exitCode}): ${run.stderr}`,
      );
    return lines(run.stdout).map((line) => line.split("|"));
  }
  /** Hand-written probe connection as the restricted app role. */
  const probe = (script: string) =>
    runPsql(appTarget, script, { timeoutMs: 20_000 });
  const lastLine = async (script: string) => {
    const run = await probe(script);
    expect(run.exitCode, `probe failed with ${run.sqlstate}`).toBe(0);
    return lines(run.stdout).at(-1);
  };
  const execute = (
    scope: TenantScope,
    request: unknown,
    allowlist = syntheticTenancyAllowlist,
  ) =>
    executeBoundedQuery(appConfig, planBoundedQuery(scope, request, allowlist));
  const completeRows = (outcome: ExecutionOutcome) => {
    expect(outcome.status, JSON.stringify(outcome)).toBe("complete");
    return outcome.status === "complete" ? outcome.rows : [];
  };
  const allIds = (rows: readonly Record<string, unknown>[]) =>
    rows.map((row) => String(row.id)).sort();

  beforeAll(async () => {
    const server = await admin(
      "SHOW server_version_num;",
      adminTarget.database,
    );
    expect(Number(server[0]?.[0])).toBeGreaterThanOrEqual(160000);
    await admin(
      [
        "SELECT format('DROP DATABASE IF EXISTS %I WITH (FORCE)', datname) FROM pg_database WHERE datname LIKE 'analyticool\\_isolation\\_%' \\gexec",
        "DROP ROLE IF EXISTS analyticool_app;",
        "DROP ROLE IF EXISTS analyticool_reader;",
        "DROP ROLE IF EXISTS analyticool_owner;",
        `CREATE DATABASE ${database};`,
        "",
      ].join("\n"),
      adminTarget.database,
    );
    await admin(
      [
        sql("schema.sql"),
        sql("fixture.sql"),
        sql("probes.sql"),
        "ALTER ROLE analyticool_app PASSWORD :'app_password';",
        "ANALYZE;",
        "",
      ].join("\n"),
      database,
      { app_password: appPassword },
    );
    acme = issueTenantScope(
      { principalId: "user-ana", tenantId: "fictional-acme" },
      memberships,
    );
    orbit = issueTenantScope(
      { principalId: "user-oli", tenantId: "fictional-orbit" },
      memberships,
    );
  });

  afterAll(async () => {
    if (!adminUrl) return;
    await admin(
      [
        `DROP DATABASE IF EXISTS ${database} WITH (FORCE);`,
        "DROP ROLE IF EXISTS analyticool_app;",
        "DROP ROLE IF EXISTS analyticool_reader;",
        "DROP ROLE IF EXISTS analyticool_owner;",
        "",
      ].join("\n"),
      adminTarget.database,
    );
  });

  describe("catalog assertions (least privilege)", () => {
    it("app role is not superuser, has no BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION", async () => {
      expect(
        await admin(
          "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin FROM pg_roles WHERE rolname = 'analyticool_app';",
        ),
      ).toEqual([["f", "f", "f", "f", "f", "t"]]);
      expect(
        await admin(
          "SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('analyticool_owner', 'analyticool_reader') ORDER BY rolname;",
        ),
      ).toEqual([
        ["f", "f", "f"],
        ["f", "f", "f"],
      ]);
    });

    it("app role is only a member of the reader group and of no privileged role", async () => {
      expect(
        await admin(
          "SELECT g.rolname FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = 'analyticool_app' ORDER BY 1;",
        ),
      ).toEqual([["analyticool_reader"]]);
      expect(
        await admin(
          "SELECT pg_has_role('analyticool_app', r, 'MEMBER') FROM unnest(ARRAY['analyticool_owner', 'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program', 'pg_read_all_data', 'pg_write_all_data', 'pg_signal_backend']::name[]) AS r;",
        ),
      ).toEqual(Array.from({ length: 7 }, () => ["f"]));
    });

    it("app and reader own no relations, schemas or functions", async () => {
      expect(
        await admin(
          "SELECT (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname IN ('analyticool_app', 'analyticool_reader')), (SELECT count(*) FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname IN ('analyticool_app', 'analyticool_reader')), (SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname IN ('analyticool_app', 'analyticool_reader'));",
        ),
      ).toEqual([["0", "0", "0"]]);
    });

    it("app role defaults to read-only transactions and bounded timeouts", async () => {
      const settings = (
        await admin(
          "SELECT unnest(s.setconfig) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'analyticool_app';",
        )
      ).flat();
      expect(settings).toEqual(
        expect.arrayContaining([
          "default_transaction_read_only=on",
          "statement_timeout=5s",
          "idle_in_transaction_session_timeout=10s",
        ]),
      );
    });

    it("base tables ENABLE and FORCE row-level security with SELECT-only policies", async () => {
      expect(
        await admin(
          "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c WHERE c.relnamespace = 'analyticool_private'::regnamespace AND c.relkind = 'r' ORDER BY 1;",
        ),
      ).toEqual(
        ["charges", "payments", "processing_fees", "refunds"].map((t) => [
          t,
          "t",
          "t",
        ]),
      );
      expect(
        await admin(
          "SELECT tablename, cmd FROM pg_policies WHERE schemaname = 'analyticool_private' ORDER BY 1;",
        ),
      ).toEqual(
        ["charges", "payments", "processing_fees", "refunds"].map((t) => [
          t,
          "SELECT",
        ]),
      );
    });

    it("every exposed view is a security_barrier view owned by the owner role", async () => {
      const views = await admin(
        "SELECT c.relname, pg_get_userbyid(c.relowner), array_to_string(c.reloptions, ',') FROM pg_class c WHERE c.relnamespace = 'analyticool_api'::regnamespace ORDER BY 1;",
      );
      expect(views.map((v) => v[0])).toEqual(
        [...VIEWS, "verification_slow_charges"].sort(),
      );
      for (const [, owner, options] of views) {
        expect(owner).toBe("analyticool_owner");
        expect(options).toContain("security_barrier=true");
      }
    });

    it("app can SELECT only the API views and write nothing", async () => {
      const grants = await admin(
        "SELECT c.oid::regclass::text, has_table_privilege('analyticool_app', c.oid, 'SELECT'), has_table_privilege('analyticool_app', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM pg_class c WHERE c.relnamespace IN ('analyticool_private'::regnamespace, 'analyticool_api'::regnamespace) AND c.relkind IN ('r', 'v', 'm', 'S', 'p') ORDER BY 1;",
      );
      expect(grants.length).toBeGreaterThan(0);
      for (const [name, select, write] of grants) {
        expect(write, name).toBe("f");
        expect(select, name).toBe(
          name?.startsWith("analyticool_api.") ? "t" : "f",
        );
      }
      expect(
        await admin(
          "SELECT has_schema_privilege('analyticool_app', 'analyticool_private', 'USAGE'), has_schema_privilege('analyticool_app', 'analyticool_api', 'CREATE'), has_schema_privilege('analyticool_app', 'public', 'CREATE'), has_schema_privilege('analyticool_app', 'public', 'USAGE'), has_database_privilege('analyticool_app', current_database(), 'CREATE'), has_database_privilege('analyticool_app', current_database(), 'TEMP');",
        ),
      ).toEqual([["f", "f", "f", "f", "f", "f"]]);
      expect(
        await admin(
          "SELECT has_function_privilege('analyticool_app', 'pg_catalog.pg_read_file(text)', 'EXECUTE'), has_function_privilege('analyticool_app', 'pg_catalog.lo_import(text)', 'EXECUTE'), has_function_privilege('analyticool_app', 'pg_catalog.lo_from_bytea(oid, bytea)', 'EXECUTE'), has_function_privilege('analyticool_app', 'pg_catalog.pg_advisory_lock(bigint)', 'EXECUTE');",
        ),
      ).toEqual([["f", "f", "f", "f"]]);
    });
  });

  describe("tenant A cannot access tenant B through the reference executor", () => {
    it.each(DATASETS)(
      "%s: each tenant sees exactly its own rows",
      async (dataset) => {
        const fields = Object.keys(
          syntheticTenancyAllowlist.datasets[dataset]!.fields,
        );
        const acmeRows = completeRows(
          await execute(acme, { dataset, fields, timeRange }),
        );
        const orbitRows = completeRows(
          await execute(orbit, { dataset, fields, timeRange }),
        );
        expect(allIds(acmeRows)).toEqual([...ACME_IDS[dataset]].sort());
        expect(allIds(orbitRows)).toEqual([...ORBIT_IDS[dataset]].sort());
        for (const row of acmeRows) {
          expect(ORBIT_SENTINEL_AMOUNTS).not.toContain(row.amountCents);
          expect(JSON.stringify(row)).not.toContain("fictional-orbit");
        }
        for (const row of orbitRows) {
          expect(ACME_AMOUNTS).not.toContain(row.amountCents);
          expect(JSON.stringify(row)).not.toContain("fictional-acme");
        }
      },
    );

    it("a client-chosen filter on another tenant's IDs returns nothing", async () => {
      const lookup = (
        scope: TenantScope,
        dataset: string,
        ids: readonly string[],
      ) =>
        execute(scope, {
          dataset,
          fields: ["id", "amountCents"],
          timeRange,
          filters: [{ field: "id", op: "in", values: ids }],
        });
      for (const dataset of DATASETS) {
        expect(
          completeRows(await lookup(acme, dataset, ORBIT_IDS[dataset])),
        ).toEqual([]);
        expect(
          completeRows(await lookup(orbit, dataset, ACME_IDS[dataset])),
        ).toEqual([]);
      }
    });

    it("a cross-tenant parent reference does not reveal the other tenant's payment", async () => {
      const refunds = completeRows(
        await execute(acme, {
          dataset: "refunds",
          fields: ["id", "paymentId", "amountCents"],
          timeRange,
          filters: [{ field: "id", op: "eq", value: "acme-ref-cross" }],
        }),
      );
      expect(refunds).toEqual([
        { id: "acme-ref-cross", paymentId: "orbit-pay-1", amountCents: 4120 },
      ]);
      const parent = (id: string) =>
        execute(acme, {
          dataset: "payments",
          fields: ["id", "chargeId", "status", "amountCents"],
          timeRange,
          filters: [{ field: "id", op: "eq", value: id }],
        });
      // The unauthorized parent is indistinguishable from a missing one.
      expect(await parent("orbit-pay-1")).toEqual(
        await parent("no-such-payment"),
      );
      expect(completeRows(await parent("orbit-pay-1"))).toEqual([]);
      // Reverse direction: Orbit's adjustment on an Acme payment stays invisible to Acme.
      const acmeRefundsOnOwnPayment = completeRows(
        await execute(acme, {
          dataset: "refunds",
          fields: ["id", "amountCents"],
          timeRange,
          filters: [{ field: "paymentId", op: "eq", value: "acme-pay-1" }],
        }),
      );
      expect(allIds(acmeRefundsOnOwnPayment)).toEqual([
        "acme-ref-1",
        "acme-ref-2",
      ]);
    });
  });

  describe("fail-closed tenant setting", () => {
    it.each(VIEWS)(
      "%s returns zero rows without, or with an empty/unknown, tenant setting",
      async (view) => {
        expect(
          await lastLine(`SELECT count(*) FROM analyticool_api.${view};`),
        ).toBe("0");
        expect(
          await lastLine(
            `SELECT set_config('analyticool.tenant_id', '', false) IS NULL;\nSELECT count(*) FROM analyticool_api.${view};`,
          ),
        ).toBe("0");
        expect(
          await lastLine(
            `BEGIN;\nSELECT set_config('analyticool.tenant_id', 'fictional-acme', true) IS NULL;\nCOMMIT;\nSELECT count(*) FROM analyticool_api.${view};`,
          ),
        ).toBe("0");
        expect(
          await lastLine(
            `SELECT set_config('analyticool.tenant_id', 'fictional-nobody', false) IS NULL;\nSELECT count(*) FROM analyticool_api.${view};`,
          ),
        ).toBe("0");
      },
    );

    it("forced RLS scopes base tables even for the table owner", async () => {
      expect(
        (
          await admin(
            [
              "SET ROLE analyticool_owner;",
              "SELECT count(*) FROM analyticool_private.charges;",
              "SELECT count(*) FROM analyticool_private.payments;",
              "SELECT set_config('analyticool.tenant_id', 'fictional-acme', false) IS NULL;",
              "SELECT count(*) FROM analyticool_private.charges;",
              "SELECT count(*) FROM analyticool_private.payments;",
              "SELECT count(*) FROM analyticool_private.refunds;",
              "",
            ].join("\n"),
          )
        ).flat(),
      ).toEqual(["0", "0", "f", "3", "3", "3"]);
    });

    it("documents the limit: arbitrary SQL can re-point the setting, so raw SQL is never executed", async () => {
      // Defense in depth only. The executor binds the setting from a
      // server-issued scope and runs nothing but planner templates.
      expect(
        await lastLine(
          "SELECT set_config('analyticool.tenant_id', 'fictional-orbit', false) IS NULL;\nSELECT count(*) FROM analyticool_api.charges;",
        ),
      ).toBe("2");
    });
  });

  describe("writes, DDL, file access and escalation are denied for the app role", () => {
    const probes: [string, string][] = [
      [
        "INSERT via view",
        "INSERT INTO analyticool_api.charges (id, amount_cents, currency, created_at) VALUES ('probe', 1, 'USD', now());",
      ],
      [
        "UPDATE via view",
        "UPDATE analyticool_api.refunds SET amount_cents = 0;",
      ],
      ["DELETE via view", "DELETE FROM analyticool_api.refunds;"],
      ["DELETE via join view", "DELETE FROM analyticool_api.payments;"],
      [
        "INSERT base table",
        "INSERT INTO analyticool_private.refunds (id, tenant_id, payment_id, status, settled_at, amount_cents) VALUES ('probe', 'fictional-acme', 'acme-pay-1', 'settled', now(), 1);",
      ],
      ["TRUNCATE base table", "TRUNCATE analyticool_private.refunds;"],
      ["TRUNCATE view", "TRUNCATE analyticool_api.refunds;"],
      [
        "COPY FROM server file",
        "COPY analyticool_api.refunds FROM '/etc/hosts';",
      ],
      ["COPY TO server file", "COPY (SELECT 1) TO '/tmp/analyticool-probe';"],
      ["COPY base table out", "COPY analyticool_private.charges TO STDOUT;"],
      [
        "CREATE TABLE in API schema",
        "CREATE TABLE analyticool_api.probe (x int);",
      ],
      ["CREATE TABLE in public", "CREATE TABLE public.probe (x int);"],
      ["CREATE TEMP TABLE", "CREATE TEMP TABLE probe (x int);"],
      [
        "CREATE FUNCTION",
        "CREATE FUNCTION analyticool_api.probe() RETURNS int LANGUAGE sql AS 'SELECT 1';",
      ],
      ["CREATE SCHEMA", "CREATE SCHEMA probe;"],
      ["CREATE ROLE", "CREATE ROLE probe;"],
      ["CREATE DATABASE", "CREATE DATABASE probe;"],
      [
        "ALTER VIEW options",
        "ALTER VIEW analyticool_api.charges SET (security_barrier = false);",
      ],
      [
        "DISABLE RLS",
        "ALTER TABLE analyticool_private.charges DISABLE ROW LEVEL SECURITY;",
      ],
      ["DROP VIEW", "DROP VIEW analyticool_api.charges;"],
      ["SELECT base table", "SELECT * FROM analyticool_private.charges;"],
      ["SELECT pg_authid", "SELECT * FROM pg_catalog.pg_authid;"],
      ["SET ROLE owner", "SET ROLE analyticool_owner;"],
      ["SET ROLE superuser", `SET ROLE ${adminTarget.user};`],
      [
        "SET SESSION AUTHORIZATION",
        `SET SESSION AUTHORIZATION ${adminTarget.user};`,
      ],
      ["pg_read_file", "SELECT pg_read_file('/etc/hosts');"],
      ["lo_import", "SELECT lo_import('/etc/hosts');"],
      ["lo_from_bytea", "SELECT lo_from_bytea(0, decode('00', 'hex'));"],
      ["advisory lock", "SELECT pg_advisory_lock(1);"],
    ];
    const mode = {
      "read-only default": "",
      "explicitly read-write": "SET default_transaction_read_only = off;\n",
    };

    for (const [label, prefix] of Object.entries(mode))
      it.each(probes)(`${label}: %s fails`, async (_name, statement) => {
        const run = await probe(prefix + statement);
        expect(run.exitCode).not.toBe(0);
        expect(WRITE_DENIED).toContain(run.sqlstate);
      });

    it("escalation attempts are permission errors, not read-only errors", async () => {
      for (const statement of [
        "SELECT * FROM analyticool_private.charges;",
        "SET ROLE analyticool_owner;",
        "SELECT pg_read_file('/etc/hosts');",
        "SELECT lo_import('/etc/hosts');",
      ])
        expect((await probe(statement)).sqlstate, statement).toBe("42501");
    });

    it("leaves synthetic data unchanged and planner statistics hidden", async () => {
      expect(
        await admin(
          "SELECT (SELECT count(*) FROM analyticool_private.charges), (SELECT sum(amount_cents) FROM analyticool_private.refunds), (SELECT count(*) FROM pg_largeobject_metadata), (SELECT count(*) FROM pg_stats WHERE schemaname = 'analyticool_private') > 0;",
        ),
      ).toEqual([["5", "31544", "0", "t"]]);
      expect(
        await lastLine(
          "SELECT count(*) FROM pg_catalog.pg_stats WHERE schemaname = 'analyticool_private';",
        ),
      ).toBe("0");
    });
  });

  describe("time and row limits", () => {
    it("statement_timeout cancels a slow planned query with a generic code", async () => {
      const started = performance.now();
      const outcome = await execute(
        acme,
        { dataset: "slowCharges", fields: ["id"], timeRange },
        testAllowlist,
      );
      expect(outcome).toEqual({ status: "failed", code: "QUERY_TIMEOUT" });
      expect(performance.now() - started).toBeLessThan(1_900);
    });

    it("statement_timeout cancels a hand-written pg_sleep probe", async () => {
      const run = await probe(
        "BEGIN;\nSET LOCAL statement_timeout = 200;\nSELECT pg_sleep(5);",
      );
      expect(run.sqlstate).toBe("57014");
    });

    it("the role-level statement_timeout backstop applies without SET LOCAL", async () => {
      const run = await probe("SELECT pg_sleep(8);");
      expect(run.sqlstate).toBe("57014");
    });

    it("blocks instead of truncating when rows exceed the cap", async () => {
      const charges = { dataset: "charges", fields: ["id"], timeRange };
      expect(
        await execute(
          acme,
          { ...charges, dataset: "cappedCharges" },
          testAllowlist,
        ),
      ).toEqual({
        status: "blocked",
        code: "ROW_CAP_EXCEEDED",
        rowCap: 2,
      });
      expect(await execute(acme, { ...charges, limit: 2 })).toEqual({
        status: "blocked",
        code: "ROW_CAP_EXCEEDED",
        rowCap: 2,
      });
      expect(
        completeRows(await execute(acme, { ...charges, limit: 3 })),
      ).toHaveLength(3);
    });
  });

  describe("generic errors and executor preconditions", () => {
    const leaks = (outcome: ExecutionOutcome) => {
      const text = JSON.stringify(outcome);
      for (const secret of [
        appPassword,
        adminTarget.password,
        database,
        String(adminTarget.port),
        "acme-",
        "orbit-",
        "10000",
      ])
        expect(text).not.toContain(secret);
    };

    it("a wrong password yields CONNECTION_FAILED without connection details", async () => {
      const outcome = await executeBoundedQuery(
        { ...appConfig, password: "synthetic-wrong-password" },
        planBoundedQuery(acme, {
          dataset: "charges",
          fields: ["id"],
          timeRange,
        }),
      );
      expect(outcome).toEqual({ status: "failed", code: "CONNECTION_FAILED" });
      leaks(outcome);
    });

    it("a misconfigured allowlist pointing at a base table is still denied by the database", async () => {
      const outcome = await executeBoundedQuery(
        appConfig,
        planBoundedQuery(
          acme,
          {
            dataset: "misconfiguredBaseTable",
            fields: ["id", "amountCents"],
            timeRange,
          },
          testAllowlist,
        ),
      );
      expect(outcome).toEqual({ status: "failed", code: "PERMISSION_DENIED" });
      leaks(outcome);
    });

    it("privileged connection settings are rejected before connecting", async () => {
      const plan = planBoundedQuery(acme, {
        dataset: "charges",
        fields: ["id"],
        timeRange,
      });
      for (const config of [
        { ...appConfig, user: "postgres", password: adminTarget.password },
        { ...appConfig, user: "analyticool_owner" },
        { ...appConfig, mode: "production", sslmode: "disable" },
      ])
        expect(await executeBoundedQuery(config, plan)).toEqual({
          status: "failed",
          code: "CONNECTION_REJECTED",
        });
    });

    it("only planner-issued plans run; copies and hand-built SQL are refused", async () => {
      const plan = planBoundedQuery(acme, {
        dataset: "charges",
        fields: ["id"],
        timeRange,
      });
      for (const forged of [
        { ...plan },
        structuredClone(plan),
        { ...plan, text: "SELECT id FROM analyticool_private.charges" },
        {
          ...plan,
          tenant: {
            setting: "analyticool.tenant_id",
            value: "fictional-orbit",
          },
        },
      ])
        expect(
          await executeBoundedQuery(appConfig, forged as typeof plan),
        ).toEqual({
          status: "failed",
          code: "UNTRUSTED_PLAN",
        });
    });
  });
});
