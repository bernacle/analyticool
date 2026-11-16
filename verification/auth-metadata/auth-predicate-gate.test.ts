import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadStackEnv } from "./stack-env";

/**
 * BRU-492 HISTORICAL DIAGNOSTICS OF A REJECTED DESIGN (not a prototype).
 *
 * The owner accepted the Auth-boundary amendment on 2026-11-16: the
 * application/runtime/metadata-owner roles get NO managed Auth-table access and
 * NO BYPASSRLS; fresh server getUser validation replaces this predicate (see
 * metadata-rls.test.ts and docs/architecture/persistent-metrics-library.md).
 * These six probes are retained, with their CI floor, only as evidence of why
 * the original predicate was rejected and as tripwires if Supabase's managed
 * grants change. Candidates B/C below are never an active application owner.
 *
 * ADR §2/§3 ask for a narrowly granted, read-only Auth-session predicate whose
 * SECURITY DEFINER owner is NOLOGIN/NOBYPASSRLS, without altering the managed
 * Auth schema. This file records, against the real Supabase Postgres image,
 * what the hosted-realistic migration credential (`postgres`: not superuser)
 * can and cannot build. Every probe runs in a transaction that is rolled back;
 * nothing persists. Assertions describe observed platform facts, so a change
 * in Supabase's grants or RLS setup makes this file fail and forces review.
 */
const env = loadStackEnv();
const db = new pg.Client({
  ...env.db,
  application_name: "analyticool-auth-gate",
});

const USER_ID = "00000000-0000-4000-8000-00000000a492";
const SESSION_ID = "00000000-0000-4000-8000-00000000b492";

async function inRollback<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate-probe@synthetic.invalid')`,
      [USER_ID],
    );
    await db.query(
      "insert into auth.sessions (id, user_id, created_at) values ($1, $2, now())",
      [SESSION_ID, USER_ID],
    );
    return await fn();
  } finally {
    await db.query("rollback");
  }
}
async function sqlstate(sql: string): Promise<string | null> {
  await db.query("savepoint probe");
  try {
    await db.query(sql);
    await db.query("release savepoint probe");
    return null;
  } catch (error) {
    await db.query("rollback to savepoint probe");
    return (error as { code?: string }).code ?? "unknown";
  }
}
const visibleSessions = async () =>
  Number(
    (
      await db.query("select count(*) as n from auth.sessions where id = $1", [
        SESSION_ID,
      ])
    ).rows[0].n,
  );

beforeAll(async () => {
  await db.connect();
  const who = await db.query(
    "select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as su",
  );
  expect(who.rows[0]).toEqual({ u: "postgres", su: false });
});
afterAll(async () => {
  await db.end();
});

describe("Supabase-managed Auth tables as seen by the migration credential", () => {
  it("auth.sessions/auth.users have RLS enabled (not forced) and no policies", async () => {
    const rows = await db.query(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c where c.oid in ('auth.sessions'::regclass, 'auth.users'::regclass) order by 1`,
    );
    expect(rows.rows).toEqual([
      {
        relname: "sessions",
        relrowsecurity: true,
        relforcerowsecurity: false,
        policies: 0,
      },
      {
        relname: "users",
        relrowsecurity: true,
        relforcerowsecurity: false,
        policies: 0,
      },
    ]);
  });

  it("postgres holds SELECT WITH GRANT OPTION on the tables but no grant option on schema auth", async () => {
    const r = await db.query(
      `select has_table_privilege('auth.sessions', 'SELECT WITH GRANT OPTION') as sessions,
              has_table_privilege('auth.users', 'SELECT WITH GRANT OPTION') as users,
              has_schema_privilege('auth', 'USAGE') as usage,
              has_schema_privilege('auth', 'USAGE WITH GRANT OPTION') as usage_grantable`,
    );
    expect(r.rows[0]).toEqual({
      sessions: true,
      users: true,
      usage: true,
      usage_grantable: false,
    });
  });
});

describe("ADR-literal predicate owner: NOLOGIN, NOBYPASSRLS, narrow grants", () => {
  it("A: cannot be given schema usage, so cannot reference auth.sessions at all", async () => {
    await inRollback(async () => {
      await db.query("create role gate_a nologin nobypassrls noinherit");
      await db.query("grant gate_a to postgres with set true, inherit false");
      await db.query("grant usage on schema auth to gate_a"); // silently grants nothing
      await db.query(
        "grant select (id, user_id, created_at, not_after) on auth.sessions to gate_a",
      );
      expect(
        (
          await db.query(
            "select has_schema_privilege('gate_a', 'auth', 'USAGE') as u",
          )
        ).rows[0].u,
      ).toBe(false);
      await db.query("set local role gate_a");
      expect(await sqlstate("select 1 from auth.sessions")).toBe("42501");
    });
  });

  it("A2: with schema usage inherited from anon, RLS (no policy) hides the live session row", async () => {
    await inRollback(async () => {
      await db.query("create role gate_a2 nologin nobypassrls inherit");
      await db.query("grant gate_a2 to postgres with set true, inherit false");
      await db.query("grant anon to gate_a2");
      await db.query(
        "grant select (id, user_id, created_at, not_after) on auth.sessions to gate_a2",
      );
      expect(await visibleSessions()).toBe(1); // as postgres (BYPASSRLS)
      await db.query("set local role gate_a2");
      expect(await visibleSessions()).toBe(0);
    });
  });
});

describe("rejected candidates (diagnostic only; never an active application owner)", () => {
  it("C: dedicated NOLOGIN BYPASSRLS owner with column-only grants reads the row and nothing else of it", async () => {
    await inRollback(async () => {
      await db.query("create role gate_c nologin bypassrls inherit");
      await db.query("grant gate_c to postgres with set true, inherit false");
      await db.query("grant anon to gate_c");
      await db.query(
        "grant select (id, user_id, created_at, not_after) on auth.sessions to gate_c",
      );
      await db.query("set local role gate_c");
      expect(await visibleSessions()).toBe(1);
      expect(await sqlstate("select user_agent from auth.sessions")).toBe(
        "42501",
      );
      expect(
        await sqlstate("select refresh_token_hmac_key from auth.sessions"),
      ).toBe("42501");
      expect(
        await sqlstate(
          `update auth.sessions set not_after = now() where id = '${SESSION_ID}'`,
        ),
      ).toBe("42501");
    });
  });

  it("B: a fixed-body SECURITY DEFINER owned by postgres (Supabase's documented pattern) reads the row", async () => {
    await inRollback(async () => {
      await db.query("create schema gate_b");
      await db.query(
        `create function gate_b.session_is_active(p_session uuid, p_user uuid) returns boolean
           language sql stable security definer set search_path = pg_catalog, pg_temp
           as $$ select exists (select 1 from auth.sessions s
                                 where s.id = p_session and s.user_id = p_user
                                   and s.created_at > now() - interval '8 hours'
                                   and (s.not_after is null or s.not_after > now())) $$`,
      );
      const r = await db.query(
        "select gate_b.session_is_active($1, $2) as ok",
        [SESSION_ID, USER_ID],
      );
      expect(r.rows[0].ok).toBe(true);
      const owner = await db.query(
        "select r.rolbypassrls from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'gate_b.session_is_active(uuid,uuid)'::regprocedure",
      );
      expect(owner.rows[0].rolbypassrls).toBe(true); // broad owner: the trade-off to decide
    });
  });
});
