import type pg from "pg";
import type { Principal } from "./session-server";

/**
 * BRU-492 preparation (accepted ADR §5): the ordering contract of one
 * protected metadata operation, as a verification driver — not an
 * application module.
 *
 * For every attempt, including each bounded retry:
 *   1. fresh Supabase Auth validation (remote getUser) with NO database
 *      client checked out and therefore no metadata lock held;
 *   2. one checked-out client, one READ COMMITTED transaction, verified
 *      subject/session and the selected workspace bound transaction-locally;
 *   3. the body locks/rechecks current membership (commands use FOR SHARE).
 *
 * Accepted limit: Auth validation and commit are separate operations. A
 * revocation after step 1 can race with that bounded in-flight attempt; the
 * next validation denies. The context GUCs are issued by this trusted backend;
 * they are not an authentication boundary against its own SQL credential.
 */
export type OperationEvent =
  | Readonly<{ type: "auth-start" | "auth-end"; attempt: number }>
  | Readonly<{
      type: "tx-begin" | "tx-commit" | "tx-rollback";
      attempt: number;
    }>
  | Readonly<{ type: "denied"; attempt: number }>;

export type OperationResult<T> =
  | Readonly<{ ok: true; value: T; attempts: number; principal: Principal }>
  | Readonly<{
      ok: false;
      reason: "unauthenticated" | "retries-exhausted";
      attempts: number;
    }>;

const RETRYABLE = new Set(["40001", "40P01"]);

export async function runProtectedOperation<T>(options: {
  authenticate: () => Promise<Principal | null>;
  pool: pg.Pool;
  workspaceId: string;
  maxAttempts: number;
  body: (client: pg.PoolClient, attempt: number) => Promise<T>;
  trace?: (event: OperationEvent) => void;
}): Promise<OperationResult<T>> {
  const trace = options.trace ?? (() => {});
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    trace({ type: "auth-start", attempt });
    const principal = await options.authenticate();
    trace({ type: "auth-end", attempt });
    if (!principal) {
      trace({ type: "denied", attempt });
      return { ok: false, reason: "unauthenticated", attempts: attempt };
    }
    const client = await options.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query("begin isolation level read committed");
      trace({ type: "tx-begin", attempt });
      await client.query(
        `select pg_catalog.set_config('analyticool.user_id', $1, true),
                pg_catalog.set_config('analyticool.session_id', $2, true),
                pg_catalog.set_config('analyticool.workspace_id', $3, true),
                pg_catalog.set_config('lock_timeout', '5s', true),
                pg_catalog.set_config('statement_timeout', '10s', true)`,
        [principal.subject, principal.sessionId, options.workspaceId],
      );
      const value = await options.body(client, attempt);
      await client.query("commit");
      trace({ type: "tx-commit", attempt });
      return { ok: true, value, attempts: attempt, principal };
    } catch (error) {
      try {
        await client.query("rollback");
        trace({ type: "tx-rollback", attempt });
      } catch (rollbackError) {
        broken = rollbackError as Error;
      }
      if (!RETRYABLE.has((error as { code?: string }).code ?? "")) throw error;
    } finally {
      client.release(broken);
    }
  }
  return {
    ok: false,
    reason: "retries-exhausted",
    attempts: options.maxAttempts,
  };
}
