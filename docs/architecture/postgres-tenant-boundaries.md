# Secure PostgreSQL connection and multi-tenant query boundaries

Status: **Proposed** — BRU-461 security spike, 2026-11-14. Decision owner: repository owner and the BRU-493 implementer/reviewer. Follow-up: [BRU-493](https://linear.app/brunosimplicio/issue/BRU-493/build-mvp-read-only-postgresql-source-connector-and-metric-execution) (MVP read-only PostgreSQL source and bounded metric execution).

This spike defines a **testable tenant-isolation and least-privilege contract** for reading a PostgreSQL source. It is not a production connector. It ships three artifacts:

1. This ADR: threat model, layered contract, test matrix and BRU-493 adoption criteria.
2. A pure, IO-free contract in [`packages/core/src/query-boundary.ts`](../../packages/core/src/query-boundary.ts) with deterministic unit tests ([`query-boundary.test.ts`](../../packages/core/src/query-boundary.test.ts)), run by `pnpm test`.
3. A safe reference prototype in [`verification/postgres-isolation/`](../../verification/postgres-isolation): a synthetic two-tenant schema with restricted roles, `security_barrier` views and forced row-level security ([`schema.sql`](../../verification/postgres-isolation/schema.sql), [`fixture.sql`](../../verification/postgres-isolation/fixture.sql)); a reference executor ([`prototype.ts`](../../verification/postgres-isolation/prototype.ts)); and an adversarial real-PostgreSQL suite ([`isolation.test.ts`](../../verification/postgres-isolation/isolation.test.ts)).

The prototype is a **verification artifact**. It is not wired into the demo, it is not an API, and `pnpm dev` still needs no database.

## 1. Audited baseline

Branch point `0dea50c` (after BRU-464). Facts that constrain this design:

| Fact                                                                                                          | Evidence                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No database, connector, route handler or environment variable exists. The demo needs no DB                    | [README "Run locally"](../../README.md#run-locally), [SECURITY.md](../../SECURITY.md)                                              |
| Core is pure and IO-free. It assumes callers already authorized their rows                                    | [README boundaries](../../README.md#current-boundaries)                                                                            |
| The demo selects a fixed fictional workspace (`fictional-acme`, `fictional-orbit`) in code: not authorization | [`apps/demo/lib/demo-metric.ts`](../../apps/demo/lib/demo-metric.ts)                                                               |
| Process-local `WeakSet` capabilities already stop cloned/parsed lifecycle objects from gaining authority      | [`proposal.ts`](../../packages/core/src/proposal.ts), [metric provenance §8](metric-provenance.md#8-trust-and-security-boundaries) |
| Every fact source and parent lookup must be scoped. A cross-tenant parent is rejected, never revealed         | [metric provenance §4, §8](metric-provenance.md)                                                                                   |
| Execution reads the customer's Postgres from an isolated service: read-only role, timeouts, no client SQL     | [BRU-464 ADR §2e–f](backend-stack-and-deployment.md)                                                                               |
| CI has no service containers and no Postgres client dependency                                                | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), [`package.json`](../../package.json)                                 |

## 2. Threat model

**Assets.** Each tenant's rows (amounts, IDs, timestamps, existence of records), source credentials, and the availability of the customer database.

**Actors.**

| Actor                             | Capability assumed                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Other tenant (authenticated)      | Legitimately uses the product and crafts any request body, IDs and filters                               |
| Compromised or malicious client   | Sends arbitrary JSON: tenant IDs, SQL fragments, field names with quotes/semicolons, huge limits/ranges  |
| Prompt-injected LLM output        | Produces any text, including SQL, identifiers or JSON shaped like a request or a scope                   |
| Curious or careless app developer | Adds an allowlist entry, reuses an admin URL, logs errors, or passes a hand-built object to the executor |
| Database misconfiguration         | Superuser/owner credentials, `BYPASSRLS`, missing `FORCE`, PUBLIC grants, no TLS                         |

**Trust boundaries.** Browser → application backend (authenticates the principal, holds memberships and the allowlist) → executor (holds source credentials) → PostgreSQL role. Only the backend decides tenant scope. Only the database decides what the role can physically read.

| #   | Threat                                                                     | Mitigation (layer, §3)                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Cross-tenant read via filters or IDs                                       | L1 scope from membership; L3 views + forced RLS filter by the bound tenant; foreign IDs return nothing                                                                                                    |
| T2  | Client-supplied tenant ID                                                  | L2 strict request schema has no tenant field; L1 scope is issued only by `issueTenantScope` from server-held memberships                                                                                  |
| T3  | Forged/replayed scope or plan (clone, JSON, literal)                       | L1/L2 process-local `WeakSet` capabilities: only objects issued in this process are accepted                                                                                                              |
| T4  | Session setting (GUC) tampering                                            | L4 executor binds `analyticool.tenant_id` with `set_config(..., true)` from the scope. **Defense in depth only**: a session able to run arbitrary SQL can re-point it, so arbitrary SQL is never executed |
| T5  | SQL injection / unconstrained LLM SQL                                      | L2 one fixed template; identifiers only from a validated allowlist and quoted; every value a bind parameter; no SQL text input; executor runs only planner-issued plans                                   |
| T6  | Unknown datasets, base tables, catalogs or unlisted fields                 | L2 allowlist lookup with `Object.hasOwn`; L3 no grants outside `analyticool_api` views                                                                                                                    |
| T7  | RLS bypass via superuser, table owner or `BYPASSRLS`                       | L3 app role is not superuser, has no `BYPASSRLS`, owns nothing; `FORCE ROW LEVEL SECURITY` also binds the owner used by views; connection validator rejects privileged role names                         |
| T8  | Writes, DDL, `COPY`, temp objects, functions, file and large-object access | L3 SELECT-only grants, no CREATE/TEMP, SELECT-only policies, revoked server-file/large-object/advisory-lock functions; L4 `BEGIN READ ONLY` plus role default `default_transaction_read_only = on`        |
| T9  | Privilege escalation (`SET ROLE`, `SET SESSION AUTHORIZATION`)             | L3 app is a member of the reader group only; no membership in owner or predefined privileged roles                                                                                                        |
| T10 | Resource exhaustion (slow or huge queries, locks, idle transactions)       | L2 max range, max rows; L4 `SET LOCAL statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`; role-level timeout backstops; `LIMIT cap+1` and blocked result over the cap              |
| T11 | Silent truncation presented as complete                                    | `evaluateRowCap` returns `blocked` (no rows) when rows exceed the cap, consistent with "no complete result" in metric provenance                                                                          |
| T12 | Catalog/statistics leakage                                                 | L3 no SELECT on base tables, so `pg_stats` shows nothing; no `pg_authid`/server-file access                                                                                                               |
| T13 | Error-message leakage                                                      | Core errors carry only an issue code. The executor maps SQLSTATE to generic codes and never returns server messages, row values or connection details                                                     |
| T14 | Credential leakage                                                         | Credentials passed by environment to the client process, never in argv/URLs/scripts; `describeConnection` redacts; validation errors never echo config                                                    |
| T15 | Plaintext transport / server impersonation                                 | `validateConnectionConfig` requires `sslmode=verify-full` in production; `local-test` mode only on loopback hosts                                                                                         |
| T16 | Cross-tenant parent references                                             | Adjustments and parents are scoped independently. An in-scope refund pointing at another tenant's payment resolves to "not found", indistinguishable from a missing parent                                |

Out of scope: a compromised backend or executor host (it holds credentials and decides scope), database superuser compromise, side channels such as timing, and authentication of principals (BRU-492/494).

## 3. The contract: four layers

Each layer must hold on its own. A failure in one must not expose another tenant's rows.

**Layer 1: the backend derives tenant scope.** `issueTenantScope({ principalId, tenantId }, memberships)` takes the principal from the backend's authenticated session and the memberships from server-held records. It returns a frozen `TenantScope` only when exactly one membership matches (`NO_TENANT_MEMBERSHIP`, `AMBIGUOUS_TENANT_MEMBERSHIP`, `INVALID_PRINCIPAL` otherwise). Scopes are registered in a process-local `WeakSet`. Cloned, parsed or literal objects are rejected with `UNTRUSTED_SCOPE`. Client input never contains a tenant ID.

**Layer 2: allowlist and template-only planning.** `defineDatasetAllowlist` validates server configuration (lowercase SQL identifiers, camelCase API names, timestamp time field, order keys, allowed roles, `maxRows ≤ 100,000`, `timeoutMs ≤ 30,000`, `maxRangeDays`) and registers it. `boundedQueryRequestSchema` is strict: `dataset`, `fields`, `timeRange`, optional equality/`IN` `filters`, optional `limit`. There is no `tenantId`, `sql`, `table`, `view`, `where`, `orderBy` or timeout field. `planBoundedQuery(scope, request, allowlist)` produces one template:

```sql
SELECT "<column>" AS "<field>", ... FROM "<schema>"."<view>"
WHERE "<time>" >= $1::timestamptz AND "<time>" < $2::timestamptz [AND "<column>" = $n::text ...]
ORDER BY <allowlisted keys> LIMIT $k::bigint   -- k binds rowCap + 1
```

Identifiers come only from the allowlist. Request values, including the limit, are always parameters. The tenant ID never appears in `text`: it is carried as `plan.tenant` for the executor to bind. Plans are frozen, deterministic and registered. Rejections use explicit codes: `UNKNOWN_DATASET`, `UNKNOWN_FIELD`, `ROLE_NOT_ALLOWED`, `FIELD_NOT_FILTERABLE`, `INVALID_FILTER_VALUE`, `INVALID_TIME_RANGE`, `TIME_RANGE_TOO_LARGE`, `ROW_LIMIT_TOO_LARGE`, `INVALID_REQUEST`, `UNTRUSTED_ALLOWLIST`. **No LLM or client SQL is accepted or executed.** A future natural-language feature may at most produce a request object, which this layer then validates like any other untrusted input.

**Layer 3: least-privilege database roles** ([`schema.sql`](../../verification/postgres-isolation/schema.sql)).

- `analyticool_owner`: NOLOGIN; owns the schemas, tables and views. Never used by the application.
- `analyticool_reader`: NOLOGIN group with `USAGE` on `analyticool_api` and `SELECT` on its views only.
- `analyticool_app`: LOGIN; member of `analyticool_reader` only; `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`; owns nothing; role defaults `default_transaction_read_only = on`, `statement_timeout = 5s`, `lock_timeout = 1s`, `idle_in_transaction_session_timeout = 10s`, `search_path = pg_catalog`.
- Base tables in `analyticool_private` have `ENABLE` **and** `FORCE ROW LEVEL SECURITY`, with `FOR SELECT` policies only (so all writes are denied by default). Policies compare `tenant_id` to `nullif(current_setting('analyticool.tenant_id', true), '')`, so a missing, reset or empty setting matches nothing (fail closed). Payments have no tenant column and are scoped through their charge.
- `analyticool_api` views are `security_barrier = true`, `security_invoker = false` and owned by the owner. They repeat the tenant filter, and forced RLS still applies underneath.
- `REVOKE ALL` from PUBLIC on the database (CONNECT/TEMP/CREATE), the `public` schema, both schemas and all tables. `EXECUTE` is revoked from PUBLIC on server-file functions (`pg_read_file`, `pg_ls_dir`, …), large-object functions (`lo_import`, `lo_from_bytea`, …), `dblink*` if installed, advisory locks, and backend signalling.

**Layer 4: bounded execution** ([`prototype.ts`](../../verification/postgres-isolation/prototype.ts)). It accepts only planner-issued plans (`UNTRUSTED_PLAN` otherwise) and connection settings that pass `validateConnectionConfig`. For each query it opens one session as the app role and runs:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = <plan.timeoutMs>;
SET LOCAL lock_timeout = <≤ 1000>;
SET LOCAL idle_in_transaction_session_timeout = <timeout + 1000>;
SET LOCAL search_path = pg_catalog; SET LOCAL TimeZone = 'UTC';
SELECT set_config('analyticool.tenant_id', $1, true) ...   -- $1 bound from plan.tenant
SELECT row_to_json(r)::text FROM (<plan.text>) AS r ...     -- plan.values bound
COMMIT;
```

The executor then applies `evaluateRowCap`. More than `rowCap` rows gives `blocked`/`ROW_CAP_EXCEEDED`, never a truncated result. Any error ends the session, which rolls back. Failures map to `QUERY_TIMEOUT`, `PERMISSION_DENIED`, `READ_ONLY_VIOLATION`, `CONNECTION_FAILED`, `CONNECTION_REJECTED` or `QUERY_FAILED`. Server messages are never surfaced.

To avoid a new dependency, the reference executor drives `psql` (16+) with `\bind` for real server-side parameters. Credentials go only through `PG*` environment variables in a clean child environment. BRU-493 may use a native driver instead, as long as it keeps every property above, including the extended query protocol for parameters.

**Connection settings.** `validateConnectionConfig` requires `sslmode=verify-full` in `production`. It accepts `local-test` only for `localhost`/`127.0.0.1`/`::1`. It rejects common superuser, admin and owner role names (`postgres`, `rdsadmin`, `supabase_admin`, `cloudsqlsuperuser`, `*_owner`, `*_admin`, …). Error messages contain only the code. A name check is not a privilege check, so BRU-493 must also run the catalog assertions (§5) against the real source.

## 4. Test matrix

`U` = unit test in `packages/core/src/query-boundary.test.ts` (runs in `pnpm test`). `X` = executor test in `verification/postgres-isolation/executor-script.test.ts` (no DB). `D` = real-PostgreSQL test in `verification/postgres-isolation/isolation.test.ts`.

| Threat / requirement          | Test (describe › case)                                                                                                                                                                                                                          | Kind |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| T2 server-issued scope        | server-issued tenant scope › refuses a tenant-B scope to a principal with only tenant-A membership; rejects malformed principals, memberships and conflicting roles                                                                             | U    |
| T3 forged scope               | › rejects forged scopes: clones, parsed JSON and literals grant nothing                                                                                                                                                                         | U    |
| Role-based dataset access     | › enforces dataset roles from the server-held membership                                                                                                                                                                                        | U    |
| T2 client tenant / SQL fields | strict request schema › rejects the client-supplied tenantId/tenant/sql/table/view/where/orderBy/timeoutMs field; rejects extra keys inside filters and time ranges                                                                             | U    |
| T6 allowlist                  | dataset and field allowlist › rejects unknown datasets, including base tables and catalog names; rejects fields outside the allowlist and never places them in SQL                                                                              | U    |
| T5 identifier safety          | › rejects allowlists with unsafe identifiers or inconsistent specs; only plans with a registered allowlist                                                                                                                                      | U    |
| T5 parameterization           | template-only parameterized planning › quoted allowlisted identifiers, parameters for every value, LIMIT cap+1, tenant only as parameter; deterministic                                                                                         | U    |
| T10 limits in planning        | › rejects limits above the dataset maximum and invalid or oversized ranges; default cap/timeout ≤ dataset maximum                                                                                                                               | U    |
| T11 row cap semantics         | row cap › blocks rather than truncates                                                                                                                                                                                                          | U    |
| T15/T14 connection settings   | connection settings › rejects sslmode other than verify-full outside local-test; local-test only on loopback; rejects privileged roles; never echoes password or host                                                                           | U    |
| T4/T5 executor wiring         | reference executor script › one read-only transaction with local limits; never inlines tenant ID or values; refuses untrusted plans before connecting                                                                                           | X    |
| T7/T9 role attributes         | catalog assertions › app role is not superuser/BYPASSRLS/…; only a member of reader and of no privileged role; owns nothing; read-only and timeout defaults                                                                                     | D    |
| T7 forced RLS                 | › base tables ENABLE and FORCE RLS with SELECT-only policies; every exposed view is a `security_barrier` view owned by the owner role                                                                                                           | D    |
| T6/T8 grants                  | › app can SELECT only the API views and write nothing (tables, schemas, database CREATE/TEMP, file/large-object/advisory functions)                                                                                                             | D    |
| T1/AC "A cannot read B"       | tenant A cannot access tenant B › each tenant sees exactly its own rows (every allowlisted view, both directions, sentinel amounts absent); foreign IDs return nothing                                                                          | D    |
| T16 cross-tenant parent       | › a cross-tenant parent reference does not reveal the other tenant's payment (indistinguishable from missing; reverse direction)                                                                                                                | D    |
| Fail closed                   | fail-closed tenant setting › every view returns zero rows with missing/empty/reset/unknown setting; forced RLS scopes base tables even for the owner                                                                                            | D    |
| T4 documented limit           | › arbitrary SQL can re-point the setting, so raw SQL is never executed                                                                                                                                                                          | D    |
| T8/T9 writes and escalation   | writes, DDL, file access and escalation are denied › 29 hand-written probes (INSERT/UPDATE/DELETE/TRUNCATE/COPY/CREATE/CREATE TEMP/ALTER/DROP/SET ROLE/pg_read_file/lo_*), each in read-only and explicitly read-write sessions; data unchanged | D    |
| T12 statistics                | › leaves synthetic data unchanged and planner statistics hidden                                                                                                                                                                                 | D    |
| T10 timeouts                  | time and row limits › statement_timeout cancels a slow planned query; cancels a pg_sleep probe; role-level backstop applies without SET LOCAL                                                                                                   | D    |
| T11 row cap end to end        | › blocks instead of truncating when rows exceed the cap                                                                                                                                                                                         | D    |
| T13 generic errors            | generic errors › wrong password → CONNECTION_FAILED; base-table allowlist entry still denied by the DB; privileged settings rejected; copies and hand-built SQL refused                                                                         | D    |

The `D` suite uses a verification-only slow view ([`probes.sql`](../../verification/postgres-isolation/probes.sql)) and a test-only allowlist. Neither is part of the contract.

### Running it

```sh
pnpm test                                    # includes the U cases; no database
pnpm exec vitest run --config verification/postgres-isolation/vitest.config.ts  # X cases; D cases skip without a URL
PGBIN=/path/to/postgresql/bin bash verification/postgres-isolation/run-local.sh  # disposable cluster
```

`run-local.sh` starts a throwaway cluster in a temp directory, sets `ANALYTICOOL_PG_TEST_ADMIN_URL` and removes the cluster on exit. The suite needs PostgreSQL 16+ and `psql` 16+ on `PATH` (or `ANALYTICOOL_PSQL`). **Point the admin URL only at a disposable cluster:** the suite drops and recreates the cluster-wide `analyticool_*` roles and `analyticool_isolation_*` databases.

### Verification status

- Unit (`U`) and executor-script (`X`) tests pass locally on Node 24.21.0.
- The real-PostgreSQL (`D`) suite was written against PostgreSQL 16/17 semantics but **was not executed by the implementer**: the spike's sandbox could not start a local server. The orchestrator's check runs it on Homebrew `postgresql@17`. Until a green run is recorded here, treat the `D` rows as specified, not verified.
- The suite is not in GitHub Actions. Adding a CI job with a Postgres service container needs a workflow change, which was outside this spike's permissions (see §7).

## 5. BRU-493 adoption criteria (must not weaken)

BRU-493 may change implementation details, but it must keep each of these properties, with tests:

1. Tenant scope comes only from server-held membership via a `TenantScope`-equivalent capability. No request, token claim parsed without verification, or LLM output can name a tenant.
2. Requests stay strict data (dataset, fields, range, typed filters, limit). No SQL text, raw identifiers, or expression language. Only a reviewed allowlist adds identifiers. Every value is a bind parameter.
3. The executor runs only planner output. No "escape hatch" for raw SQL, including for admins or debugging.
4. The source role passes the §4 catalog assertions on the **real** customer database before first use, and again on each connection-config change: not superuser, no `BYPASSRLS`, owns nothing, SELECT on allowlisted views only, no CREATE/TEMP, no privileged role memberships. A failing check blocks execution.
5. Where Analyticool controls the schema (as in this reference), tenant filtering is enforced in the database too (forced RLS and/or `security_barrier` views that fail closed). Where a customer exposes single-tenant views, the allowlist must point at them, not at multi-tenant base tables.
6. Every query runs in a `READ ONLY` transaction with local statement, lock and idle timeouts no larger than the allowlist maximum, and `LIMIT cap+1`. Exceeding the cap blocks the result.
7. Production connections use `sslmode=verify-full` with a pinned CA. Credentials stay in the isolated executor (BRU-464 §2f), never in logs, errors, argv or the browser.
8. Errors cross the boundary only as generic codes.
9. The adversarial `D` suite (or its equivalent) runs in CI against a real PostgreSQL. Every matrix row stays covered, including both tenant directions and cross-tenant parents.

## 6. Non-goals

No production connector, connection management UI, secret storage, pooling, or hosted service. No Stripe or other source, no generic multi-source federation, no LLM SQL, no general SQL planner, no metric execution against PostgreSQL, no demo or UI changes, no new dependencies. Principal authentication remains BRU-492/494.

## 7. Decisions for review (open questions)

Each choice is the most conservative one and easy to change.

- **Postgres client and CI job.** I added no dependency (`pg` is not installed, and dependency changes were out of scope). The executor uses the `psql` client through `child_process`. I did not edit GitHub Actions (workflow edits were out of scope). The suite is opt-in via `ANALYTICOOL_PG_TEST_ADMIN_URL` and its own Vitest config. I did not add a `package.json` script, because `package.json` is pinned by the net receipts evidence digest and changing it would mean regenerating unrelated evidence. Recommendation: a follow-up adds the script, regenerates that evidence deliberately, and adds a CI job with a `postgres:17` service container.
- **Minimum PostgreSQL version: 16** (server and `psql`). The reference uses `security_invoker` view options (15+) and `psql \bind` (16+). It does not rely on `security_invoker = true`.
- **Location.** The pure contract lives in `packages/core` (the repository's home for contracts). The executor stays in `verification/` until BRU-493 decides where the isolated executor service lives.
- **Default limits are placeholders:** 10,000 rows, 5 s statement timeout, 1 s lock timeout, 366-day range per dataset. Allowlist ceilings are 100,000 rows and 30 s. They are product decisions for BRU-493.
- **Exceeding the row cap blocks** the result (no partial rows), consistent with metric provenance's "no complete result".
- **No EXPLAIN-based cost ceiling.** Timeouts, range limits and row caps only. An `EXPLAIN` cost check is a planner estimate, not a bound, and can be added later as an extra gate.
- **Principals and memberships** are synthetic, server-held input here. Their authentication is BRU-492/494.
