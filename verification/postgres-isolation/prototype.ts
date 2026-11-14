import {
  evaluateRowCap,
  isIssuedQueryPlan,
  QueryBoundaryError,
  validateConnectionConfig,
  type BoundedQueryPlan,
} from "../../packages/core/src/query-boundary";
import { runPsql, type PsqlRun } from "./psql";

/**
 * BRU-461 safe reference executor (Layer 4). Verification artifact, not a
 * connector: it is the only IO in this spike and runs only planner output.
 *
 * Per query: a fresh session as the restricted app role, one
 * `BEGIN READ ONLY` transaction, SET LOCAL timeouts, the tenant setting bound
 * as a parameter through set_config(..., true), the planned statement with
 * bound parameters (psql \bind), then the row cap. Any error ends the session,
 * which rolls the transaction back. Failures map to generic codes; database
 * messages, row values and connection details are never returned.
 */
export type ExecutorFailureCode =
  | "UNTRUSTED_PLAN"
  | "CONNECTION_REJECTED"
  | "CONNECTION_FAILED"
  | "QUERY_TIMEOUT"
  | "PERMISSION_DENIED"
  | "READ_ONLY_VIOLATION"
  | "QUERY_FAILED";

export type ExecutionOutcome =
  | Readonly<{
      status: "complete";
      rows: readonly Readonly<Record<string, unknown>>[];
    }>
  | Readonly<{ status: "blocked"; code: "ROW_CAP_EXCEEDED"; rowCap: number }>
  | Readonly<{ status: "failed"; code: ExecutorFailureCode }>;

const ROWS_MARKER = "__analyticool_rows__";
const failed = (code: ExecutorFailureCode): ExecutionOutcome =>
  Object.freeze({ status: "failed", code });

function failureFor(
  sqlstate: string | null,
  exitCode: number | null,
): ExecutorFailureCode {
  if (sqlstate === null)
    return exitCode === 2 || exitCode === null
      ? "CONNECTION_FAILED"
      : "QUERY_FAILED";
  if (sqlstate === "57014" || sqlstate === "55P03" || sqlstate === "25P03")
    return "QUERY_TIMEOUT";
  if (sqlstate === "42501") return "PERMISSION_DENIED";
  if (sqlstate === "25006") return "READ_ONLY_VIOLATION";
  if (sqlstate.startsWith("08") || sqlstate.startsWith("28"))
    return "CONNECTION_FAILED";
  return "QUERY_FAILED";
}

const ms = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError("Invalid timeout.");
  return String(value);
};

/** Builds the psql script. Exported for review; contains no request values. */
export function executorScript(plan: BoundedQueryPlan): string {
  // Planner text is a fixed template; refuse anything psql could reinterpret.
  if (/[;\\\r\n]/.test(plan.text))
    throw new QueryBoundaryError("UNTRUSTED_PLAN");
  const params = plan.values.map((_, index) => `:p${index + 1}`).join(" ");
  return [
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;",
    `SET LOCAL statement_timeout = ${ms(plan.timeoutMs)};`,
    `SET LOCAL lock_timeout = ${ms(plan.lockTimeoutMs)};`,
    `SET LOCAL idle_in_transaction_session_timeout = ${ms(plan.idleInTransactionTimeoutMs)};`,
    "SET LOCAL search_path = pg_catalog;",
    "SET LOCAL TimeZone = 'UTC';",
    "SELECT pg_catalog.set_config('analyticool.tenant_id', $1, true) IS NOT NULL \\bind :tenant \\g",
    `\\echo ${ROWS_MARKER}`,
    `SELECT pg_catalog.row_to_json(r)::text FROM (${plan.text}) AS r \\bind ${params} \\g`,
    "COMMIT;",
    "",
  ].join("\n");
}

export async function executeBoundedQuery(
  connection: unknown,
  plan: BoundedQueryPlan,
  /** Injectable only so tests can prove runner failures stay generic. */
  runner: typeof runPsql = runPsql,
): Promise<ExecutionOutcome> {
  if (!isIssuedQueryPlan(plan)) return failed("UNTRUSTED_PLAN");
  let config;
  try {
    config = validateConnectionConfig(connection);
  } catch {
    return failed("CONNECTION_REJECTED");
  }
  let script: string;
  try {
    script = executorScript(plan);
  } catch {
    return failed("UNTRUSTED_PLAN");
  }
  const variables: Record<string, string> = { tenant: plan.tenant.value };
  plan.values.forEach(
    (value, index) => (variables[`p${index + 1}`] = String(value)),
  );
  let run: PsqlRun;
  try {
    run = await runner(config, script, {
      variables,
      timeoutMs: plan.timeoutMs + 10_000,
    });
  } catch {
    // Spawn/runner errors can embed env values (including the password):
    // never propagate or inspect their messages.
    return failed("QUERY_FAILED");
  }
  if (run.timedOut) return failed("QUERY_TIMEOUT");
  if (run.exitCode !== 0) return failed(failureFor(run.sqlstate, run.exitCode));

  const lines = run.stdout.split("\n");
  const start = lines.indexOf(ROWS_MARKER);
  if (start < 0) return failed("QUERY_FAILED");
  const rows: Record<string, unknown>[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.length === 0) continue;
    try {
      rows.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      return failed("QUERY_FAILED");
    }
  }
  const capped = evaluateRowCap(rows, plan.rowCap);
  if (capped.status === "blocked") return capped;
  return Object.freeze({ status: "complete", rows: Object.freeze(rows) });
}
