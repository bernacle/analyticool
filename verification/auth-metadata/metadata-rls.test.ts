import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  runProtectedOperation,
  type OperationEvent,
} from "./protected-operation";
import { createRequestAuth, type SessionServerOptions } from "./session-server";
import { loadStackEnv } from "./stack-env";

/**
 * BRU-492 preparation: metadata authorization PATTERN probe (accepted ADR
 * §3/§5) on the real Supabase Postgres of the disposable stack, connecting as
 * an ACTUAL runtime LOGIN. Generic probe_items only: no metric, lifecycle or
 * production schema. Fails (never skips) without the stack. The probe schema
 * and roles are created per run and dropped afterwards.
 */
const env = loadStackEnv();
const OWNER = "bru492_probe_owner";
const RUNTIME = "bru492_probe_runtime";
const S = "bru492_probe";
const EIGHT_HOURS = 8 * 60 * 60;
const runtimePassword = randomBytes(24).toString("hex");

const admin = new pg.Client({
  ...env.db,
  application_name: "bru492-probe-operator",
});
const runtimeConfig = (application_name: string) => ({
  ...env.db,
  user: RUNTIME,
  password: runtimePassword,
  application_name,
});
let runtime: pg.Client;

type Ctx = Readonly<{ user?: string; session?: string; workspace?: string }>;
const WA = randomUUID();
const WB = randomUUID();
const UA = randomUUID(); // editor in A
const UB = randomUUID(); // editor in B
const UV = randomUUID(); // viewer in A
const UAD = randomUUID(); // admin in A
const SA = randomUUID();
const SB = randomUUID();
const ctxA: Ctx = { user: UA, session: SA, workspace: WA };
const ctxB: Ctx = { user: UB, session: SB, workspace: WB };

async function dropProbe() {
  const owner = await admin.query("select 1 from pg_roles where rolname = $1", [
    OWNER,
  ]);
  if (owner.rowCount) {
    await admin.query(
      `grant ${OWNER} to postgres with set true, inherit false`,
    );
    await admin.query(`set role ${OWNER}`);
    await admin.query(`drop schema if exists ${S} cascade`);
    await admin.query("reset role");
  }
  await admin.query(`drop role if exists ${RUNTIME}`);
  await admin.query(`drop role if exists ${OWNER}`);
}

async function setContext(client: pg.ClientBase, ctx: Ctx) {
  await client.query(
    `select pg_catalog.set_config('analyticool.user_id', $1, true),
            pg_catalog.set_config('analyticool.session_id', $2, true),
            pg_catalog.set_config('analyticool.workspace_id', $3, true)`,
    [ctx.user ?? "", ctx.session ?? "", ctx.workspace ?? ""],
  );
}
/** One runtime transaction with transaction-local context; always rolled back unless commit. */
async function asRuntime<T>(
  ctx: Ctx | null,
  fn: (c: pg.Client) => Promise<T>,
  { commit = false, client = runtime } = {},
): Promise<T> {
  await client.query("begin");
  try {
    if (ctx) await setContext(client, ctx);
    const result = await fn(client);
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
/** SQLSTATE of a statement inside the current transaction (null = success). */
async function sqlstate(
  client: pg.ClientBase,
  sql: string,
  params: unknown[] = [],
): Promise<string | null> {
  await client.query("savepoint s");
  try {
    await client.query(sql, params);
    await client.query("release savepoint s");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint s");
    return (error as { code?: string }).code ?? "unknown";
  }
}
const ids = async (c: pg.ClientBase, sql: string, params: unknown[] = []) =>
  (await c.query<{ id: string }>(sql, params)).rows.map((r) => r.id).sort();
const createItem = (ctx: Ctx, title: string) =>
  asRuntime(
    ctx,
    async (c) =>
      (
        await c.query<{ id: string }>(`select ${S}.create_item($1) as id`, [
          title,
        ])
      ).rows[0]?.id as string,
    { commit: true },
  );

let itemA: string;
let itemB: string;

beforeAll(async () => {
  await admin.connect();
  await dropProbe();
  await admin.query(
    `create role ${RUNTIME} login nobypassrls noinherit nocreatedb nocreaterole noreplication connection limit 10 password '${runtimePassword}'`,
  );
  await admin.query(
    readFileSync(new URL("./metadata-probe.sql", import.meta.url), "utf8"),
  );
  await admin.query(`insert into ${S}.workspaces (id) values ($1), ($2)`, [
    WA,
    WB,
  ]);
  await admin.query(
    `insert into ${S}.memberships (workspace_id, user_id, role) values
       ($1, $3, 'editor'), ($2, $4, 'editor'), ($1, $5, 'viewer'), ($1, $6, 'admin')`,
    [WA, WB, UA, UB, UV, UAD],
  );
  runtime = new pg.Client(runtimeConfig("bru492-probe-runtime"));
  await runtime.connect();
  itemA = await createItem(ctxA, "alpha item");
  itemB = await createItem(ctxB, "beta item");
});
afterAll(async () => {
  await runtime?.end();
  await dropProbe();
  await admin.end();
});

describe("catalog: actual runtime login, owner and objects", () => {
  it("runtime is a real LOGIN with no superuser, BYPASSRLS, CREATEROLE/DB, inheritance or role membership, and owns nothing", async () => {
    const who = await runtime.query(
      `select current_user as u, session_user as s, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
              r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolinherit,
              (select count(*)::int from pg_auth_members m where m.member = r.oid) as memberships,
              (select count(*)::int from pg_class c where c.relowner = r.oid) +
              (select count(*)::int from pg_proc p where p.proowner = r.oid) +
              (select count(*)::int from pg_namespace n where n.nspowner = r.oid) as owned
         from pg_roles r where r.rolname = current_user`,
    );
    expect(who.rows[0]).toEqual({
      u: RUNTIME,
      s: RUNTIME,
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolinherit: false,
      memberships: 0,
      owned: 0,
    });
    const role = await runtime.query(
      `select pg_has_role($1, 'MEMBER') as owner_member, pg_has_role('postgres', 'MEMBER') as pg_member,
              pg_has_role('anon', 'MEMBER') as anon_member, pg_has_role('authenticated', 'MEMBER') as authn_member`,
      [OWNER],
    );
    expect(Object.values(role.rows[0])).toEqual([false, false, false, false]);
  });

  it("owner is NOLOGIN/NOBYPASSRLS, owns every probe object, and every table has RLS enabled and FORCED", async () => {
    const owner = await admin.query(
      "select rolcanlogin, rolbypassrls, rolsuper, rolinherit from pg_roles where rolname = $1",
      [OWNER],
    );
    expect(owner.rows[0]).toEqual({
      rolcanlogin: false,
      rolbypassrls: false,
      rolsuper: false,
      rolinherit: false,
    });
    const tables = await admin.query(
      `select c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relkind = 'r' order by 1`,
      [S],
    );
    expect(tables.rows.map((r) => r.relname)).toEqual([
      "memberships",
      "probe_item_notes",
      "probe_items",
      "workspaces",
    ]);
    for (const t of tables.rows)
      expect(t, t.relname).toMatchObject({
        owner: OWNER,
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
    const nonOwned = await admin.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = $1 and pg_get_userbyid(p.proowner) <> $2
       union all select nspname from pg_namespace where nspname = $1 and pg_get_userbyid(nspowner) <> $2`,
      [S, OWNER],
    );
    expect(nonOwned.rows).toEqual([]);
  });

  it("commands are SECURITY DEFINER with a fixed safe search_path; context helpers are invokers; PUBLIC and Data API roles cannot execute", async () => {
    const fns = await admin.query(
      `select p.proname, p.prosecdef, p.proconfig,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), true) as public_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as service,
              has_function_privilege($2, p.oid, 'EXECUTE') as runtime
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = $1 order by 1`,
      [S, RUNTIME],
    );
    const byName = Object.fromEntries(fns.rows.map((r) => [r.proname, r]));
    expect(Object.keys(byName).sort()).toEqual([
      "add_note",
      "context_uuid",
      "create_item",
      "ctx_session",
      "ctx_user",
      "ctx_workspace",
    ]);
    for (const row of fns.rows) {
      expect(row.proconfig, row.proname).toEqual([
        "search_path=pg_catalog, pg_temp",
      ]);
      expect(row, row.proname).toMatchObject({
        public_exec: false,
        anon: false,
        authn: false,
        service: false,
        runtime: true,
      });
      expect(row.prosecdef, row.proname).toBe(
        ["create_item", "add_note"].includes(row.proname),
      );
    }
    const schema = await admin.query(
      `select has_schema_privilege('anon', $1, 'USAGE') as anon,
              has_schema_privilege('authenticated', $1, 'USAGE') as authn,
              has_schema_privilege('service_role', $1, 'USAGE') as service,
              has_schema_privilege('public', $1, 'USAGE') as public`,
      [S],
    );
    expect(Object.values(schema.rows[0])).toEqual([false, false, false, false]);
  });

  it("policies are non-recursive: the membership policy reads only verified context, item policies look up only the caller's member row", async () => {
    const policies = await admin.query(
      `select tablename, policyname, cmd, roles, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
         from pg_policies where schemaname = $1 order by 1, 2`,
      [S],
    );
    const forTable = (t: string) =>
      policies.rows.filter((p) => p.tablename === t);
    expect(forTable("workspaces")).toEqual([]);
    for (const p of forTable("memberships")) {
      expect(p.expr).not.toMatch(
        /probe_items|probe_item_notes|memberships|workspaces/,
      );
      expect(p.expr).toMatch(/ctx_user\(\)/);
    }
    for (const t of ["probe_items", "probe_item_notes"])
      for (const p of forTable(t)) {
        expect(p.expr, p.policyname).toMatch(/bru492_probe\.memberships m/);
        expect(p.expr, p.policyname).not.toMatch(
          t === "probe_items" ? /probe_item_notes/ : /probe_items\b/,
        );
      }
    expect(
      policies.rows.every((p) => !String(p.roles).includes("public")),
    ).toBe(true);
    // Helpers used inside policies read only GUCs, never a table.
    const helpers = await admin.query(
      `select proname, prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = $1 and (proname like 'ctx\\_%' or proname = 'context_uuid')`,
      [S],
    );
    expect(helpers.rows).toHaveLength(4);
    for (const h of helpers.rows)
      expect(h.prosrc, h.proname).not.toMatch(/\bfrom\s+bru492_probe\./i);
    // And evaluating them never trips recursion detection.
    await asRuntime(ctxA, async (c) => {
      expect(
        await sqlstate(c, `select count(*) from ${S}.probe_item_notes`),
      ).toBeNull();
    });
  });
});

describe("runtime cannot escalate", () => {
  it("cannot SET ROLE to the owner, the migration role or Data API roles", async () => {
    await asRuntime(null, async (c) => {
      for (const role of [
        OWNER,
        "postgres",
        "anon",
        "authenticated",
        "service_role",
      ])
        expect(await sqlstate(c, `set local role ${role}`), role).toBe("42501");
      expect(
        await sqlstate(c, `set local session authorization ${OWNER}`),
      ).toBe("42501");
    });
  });

  it("cannot create schema objects in the probe schema, public or a new schema", async () => {
    await asRuntime(null, async (c) => {
      for (const sql of [
        `create table ${S}.x (i int)`,
        `create view ${S}.v as select 1`,
        `create function ${S}.f() returns int language sql as 'select 1'`,
        "create table public.bru492_x (i int)",
        "create schema bru492_x",
      ])
        expect(await sqlstate(c, sql), sql).toBe("42501");
    });
  });

  it("cannot alter RLS, policies, ownership or grants", async () => {
    const acl = async () =>
      (
        await admin.query(
          `select (select relacl::text from pg_class where oid = '${S}.probe_items'::regclass) as t,
                  (select proacl::text from pg_proc where oid = '${S}.create_item(text)'::regprocedure) as f`,
        )
      ).rows[0];
    const before = await acl();
    await asRuntime(null, async (c) => {
      for (const sql of [
        `alter table ${S}.probe_items disable row level security`,
        `alter table ${S}.probe_items no force row level security`,
        `drop policy items_member_read on ${S}.probe_items`,
        `create policy p on ${S}.probe_items for select using (true)`,
        `alter function ${S}.create_item(text) owner to ${RUNTIME}`,
        `alter function ${S}.create_item(text) reset search_path`,
        `alter table ${S}.probe_items owner to ${RUNTIME}`,
      ])
        expect(await sqlstate(c, sql), sql).toBe("42501");
      // Without grant options PostgreSQL only warns; prove nothing changed.
      for (const sql of [
        `grant select on ${S}.probe_items to public`,
        `grant execute on function ${S}.create_item(text) to anon`,
        `grant insert on ${S}.probe_items to ${RUNTIME}`,
      ])
        expect([null, "42501"]).toContain(await sqlstate(c, sql));
    });
    expect(await acl()).toEqual(before);
  });

  it("has no direct DML on protected tables and cannot lock membership rows itself", async () => {
    await asRuntime(ctxA, async (c) => {
      for (const sql of [
        `insert into ${S}.probe_items (workspace_id, title, created_by, created_session) values ('${WA}', 'x', '${UA}', '${SA}')`,
        `update ${S}.probe_items set title = 'x'`,
        `delete from ${S}.probe_items`,
        `insert into ${S}.probe_item_notes (workspace_id, item_id, body, created_by) values ('${WA}', '${itemA}', 'x', '${UA}')`,
        `delete from ${S}.probe_item_notes`,
        `insert into ${S}.memberships values ('${WB}', '${UA}', 'admin')`,
        `update ${S}.memberships set role = 'admin'`,
        `delete from ${S}.memberships`,
        `insert into ${S}.workspaces values ('${randomUUID()}')`,
        `select * from ${S}.workspaces`,
        `select 1 from ${S}.memberships for share`,
        `select 1 from ${S}.memberships for key share`,
        `truncate ${S}.probe_items`,
      ])
        expect(await sqlstate(c, sql), sql).toBe("42501");
    });
  });

  it("has no access to managed Supabase Auth tables", async () => {
    await asRuntime(null, async (c) => {
      for (const sql of [
        "select 1 from auth.sessions",
        "select 1 from auth.users",
        "select 1 from auth.mfa_amr_claims",
      ])
        expect(await sqlstate(c, sql), sql).toBe("42501");
    });
  });

  it("a definer command ignores the caller's search_path and temp-table shadowing", async () => {
    await asRuntime({ user: UV, session: SA, workspace: WA }, async (c) => {
      await c.query(
        "create temp table memberships (workspace_id uuid, user_id uuid, role text) on commit drop",
      );
      await c.query(
        "insert into pg_temp.memberships values ($1, $2, 'admin')",
        [WA, UV],
      );
      await c.query("set local search_path = pg_temp, public");
      await c.query("savepoint s");
      // The command's own membership check denies (not merely the RLS WITH
      // CHECK backstop), so it read the real member row, not the shadow.
      await expect(
        c.query(`select ${S}.create_item('shadowed')`),
      ).rejects.toMatchObject({ code: "42501", message: "access denied" });
      await c.query("rollback to savepoint s");
    });
  });

  it("the owner itself obeys FORCE RLS: no context sees nothing, and it cannot write for another actor", async () => {
    await admin.query("begin");
    try {
      await admin.query(`set local role ${OWNER}`);
      expect(
        (await admin.query(`select count(*)::int as n from ${S}.probe_items`))
          .rows[0].n,
      ).toBe(0);
      await setContext(admin, ctxA);
      expect(
        await sqlstate(
          admin,
          `insert into ${S}.probe_items (workspace_id, title, created_by, created_session) values ($1, 'forged', $2, $3)`,
          [WA, UB, SA],
        ),
      ).toBe("42501");
      expect(
        await sqlstate(
          admin,
          `update ${S}.memberships set role = 'admin' where user_id = $1`,
          [UA],
        ),
      ).toBe("42501");
    } finally {
      await admin.query("rollback");
    }
  });
});

describe("context and workspace isolation", () => {
  it("missing, empty, malformed and unknown context denies reads and commands", async () => {
    const contexts: [string, Ctx | null][] = [
      ["no context", null],
      ["empty", {}],
      ["malformed workspace", { ...ctxA, workspace: "not-a-uuid" }],
      [
        "injection-shaped workspace",
        { ...ctxA, workspace: `${WA}' or true --` },
      ],
      ["unknown workspace", { ...ctxA, workspace: randomUUID() }],
      ["unknown user", { ...ctxA, user: randomUUID() }],
      ["missing session", { user: UA, workspace: WA }],
      ["missing user", { session: SA, workspace: WA }],
    ];
    for (const [label, ctx] of contexts)
      await asRuntime(ctx, async (c) => {
        const n = (
          await c.query(
            `select (select count(*) from ${S}.probe_items)::int as items,
                    (select count(*) from ${S}.probe_item_notes)::int as notes`,
          )
        ).rows[0];
        expect(n, label).toEqual({ items: 0, notes: 0 });
        expect(
          await sqlstate(c, `select ${S}.create_item('denied')`),
          label,
        ).toBe("42501");
      });
  });

  it("workspace A and B are isolated in both directions: list, search, count, lookup and commands", async () => {
    for (const [ctx, own, foreign, otherWs] of [
      [ctxA, itemA, itemB, WB],
      [ctxB, itemB, itemA, WA],
    ] as const) {
      await asRuntime(ctx, async (c) => {
        expect(await ids(c, `select id from ${S}.probe_items`)).toContain(own);
        expect(await ids(c, `select id from ${S}.probe_items`)).not.toContain(
          foreign,
        );
        expect(
          await ids(
            c,
            `select id from ${S}.probe_items where title ilike '%item%'`,
          ),
        ).not.toContain(foreign);
        expect(
          await ids(c, `select id from ${S}.probe_items where id = $1`, [
            foreign,
          ]),
        ).toEqual([]);
        expect(
          (
            await c.query(
              `select count(*)::int as n from ${S}.probe_items where workspace_id = $1`,
              [otherWs],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await c.query(`select distinct workspace_id from ${S}.probe_items`)
          ).rows.map((r) => r.workspace_id),
        ).toEqual([ctx.workspace]);
        // Own membership rows only.
        expect(
          (await c.query(`select user_id from ${S}.memberships`)).rows.map(
            (r) => r.user_id,
          ),
        ).toEqual([ctx.user]);
      });
      // Selecting the other workspace as an untrusted selector grants nothing.
      await asRuntime({ ...ctx, workspace: otherWs }, async (c) => {
        expect(await ids(c, `select id from ${S}.probe_items`)).toEqual([]);
        expect(await sqlstate(c, `select ${S}.create_item('x')`)).toBe("42501");
      });
    }
  });

  it("cross-workspace references: the composite FK rejects them, and a foreign item is indistinguishable from a missing one", async () => {
    expect(
      await (async () => {
        await admin.query("begin");
        try {
          return await sqlstate(
            admin,
            `insert into ${S}.probe_item_notes (workspace_id, item_id, body, created_by) values ($1, $2, 'x', $3)`,
            [WA, itemB, UA],
          );
        } finally {
          await admin.query("rollback");
        }
      })(),
    ).toBe("23503");
    const failure = async (item: string) =>
      asRuntime(ctxA, async (c) => {
        try {
          await c.query(`select ${S}.add_note($1, 'x')`, [item]);
          return null;
        } catch (error) {
          const e = error as { code?: string; message?: string };
          return { code: e.code, message: e.message };
        }
      });
    const foreign = await failure(itemB);
    expect(foreign).toEqual({ code: "P0002", message: "not found" });
    expect(await failure(randomUUID())).toEqual(foreign);
    const note = await asRuntime(
      ctxA,
      async (c) =>
        (await c.query(`select ${S}.add_note($1, 'ok') as id`, [itemA])).rows[0]
          .id,
      { commit: true },
    );
    await asRuntime(ctxB, async (c) => {
      expect(
        await ids(c, `select id from ${S}.probe_item_notes`),
      ).not.toContain(note);
    });
  });

  it("role matrix: viewer reads but cannot write; editor and admin write; attribution comes only from verified context", async () => {
    await asRuntime({ user: UV, session: SA, workspace: WA }, async (c) => {
      expect(await ids(c, `select id from ${S}.probe_items`)).toContain(itemA);
      expect(await sqlstate(c, `select ${S}.create_item('viewer')`)).toBe(
        "42501",
      );
      expect(
        await sqlstate(c, `select ${S}.add_note($1, 'viewer')`, [itemA]),
      ).toBe("42501");
    });
    for (const user of [UA, UAD]) {
      const session = randomUUID();
      const id = await createItem({ user, session, workspace: WA }, "writer");
      const row = await admin.query(
        `select workspace_id, created_by, created_session from ${S}.probe_items where id = $1`,
        [id],
      );
      expect(row.rows[0]).toEqual({
        workspace_id: WA,
        created_by: user,
        created_session: session,
      });
    }
    // Commands take no workspace/actor/role arguments at all.
    const args = await admin.query(
      `select proname, pg_get_function_arguments(oid) as args from pg_proc
        where pronamespace = $1::regnamespace and prosecdef order by 1`,
      [S],
    );
    expect(args.rows).toEqual([
      { proname: "add_note", args: "p_item uuid, p_body text" },
      { proname: "create_item", args: "p_title text" },
    ]);
  });

  it("a pooled runtime connection does not leak context between transactions (A, none, B, failed)", async () => {
    const pool = new pg.Pool({ ...runtimeConfig("bru492-probe-pool"), max: 1 });
    try {
      const visible = async (ctx: Ctx | null, fail = false) => {
        const c = await pool.connect();
        try {
          await c.query("begin");
          if (ctx) await setContext(c, ctx);
          const r = await ids(c, `select id from ${S}.probe_items`);
          const setting = (
            await c.query(
              "select current_setting('analyticool.workspace_id', true) as w",
            )
          ).rows[0].w;
          if (fail) await c.query("select 1/0").catch(() => undefined);
          await c.query(fail ? "rollback" : "commit");
          return { ids: r, setting };
        } finally {
          c.release();
        }
      };
      const a = await visible(ctxA);
      expect(a.ids).toContain(itemA);
      expect(a.setting).toBe(WA);
      expect(await visible(null)).toEqual({ ids: [], setting: "" });
      const b = await visible(ctxB, true);
      expect(b.ids).toContain(itemB);
      expect(b.ids).not.toContain(itemA);
      expect(await visible(null)).toEqual({ ids: [], setting: "" });
      expect(pool.totalCount).toBe(1); // one physical connection throughout
    } finally {
      await pool.end();
    }
  });

  it("trust boundary: the runtime credential itself can assert any member's context; GUCs are not authentication", async () => {
    // Only the trusted backend, after fresh Supabase Auth validation, may set
    // context. Arbitrary SQL under this credential can impersonate a member:
    // RLS does not defend a compromised backend credential (ADR §3).
    await asRuntime(ctxB, async (c) => {
      expect(await ids(c, `select id from ${S}.probe_items`)).toContain(itemB);
    });
  });
});

describe("current membership: demotion, revocation and serialization", () => {
  const otherClient = () =>
    new pg.Client(runtimeConfig("bru492-probe-runtime-2"));
  const waitForLockWait = async (applicationName: string) => {
    for (let i = 0; i < 100; i += 1) {
      const r = await admin.query(
        "select count(*)::int as n from pg_stat_activity where application_name = $1 and wait_event_type = 'Lock'",
        [applicationName],
      );
      if (r.rows[0].n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`${applicationName} never waited on a lock`);
  };

  it("demotion and revocation take effect on the very next command and read", async () => {
    await admin.query(
      `update ${S}.memberships set role = 'viewer' where workspace_id = $1 and user_id = $2`,
      [WA, UA],
    );
    try {
      await asRuntime(ctxA, async (c) => {
        expect(await sqlstate(c, `select ${S}.create_item('demoted')`)).toBe(
          "42501",
        );
        expect(await ids(c, `select id from ${S}.probe_items`)).toContain(
          itemA,
        );
      });
      await admin.query(
        `delete from ${S}.memberships where workspace_id = $1 and user_id = $2`,
        [WA, UA],
      );
      await asRuntime(ctxA, async (c) => {
        expect(await ids(c, `select id from ${S}.probe_items`)).toEqual([]);
        expect(await sqlstate(c, `select ${S}.create_item('revoked')`)).toBe(
          "42501",
        );
      });
    } finally {
      await admin.query(
        `insert into ${S}.memberships values ($1, $2, 'editor')
           on conflict (workspace_id, user_id) do update set role = 'editor'`,
        [WA, UA],
      );
    }
  });

  it("an operator demotion or revocation waits for an in-flight command holding the member row FOR SHARE", async () => {
    for (const change of [
      `update ${S}.memberships set role = 'viewer' where workspace_id = $1 and user_id = $2`,
      `delete from ${S}.memberships where workspace_id = $1 and user_id = $2`,
    ]) {
      await runtime.query("begin");
      try {
        await setContext(runtime, ctxA);
        await runtime.query(`select ${S}.create_item('in flight')`);
        await admin.query("begin");
        await admin.query("set local lock_timeout = '500ms'");
        expect(await sqlstate(admin, change, [WA, UA]), change).toBe("55P03");
        await admin.query("rollback");
      } finally {
        await runtime.query("rollback");
      }
      // Once the command's transaction ends, the operator change proceeds.
      await admin.query("begin");
      expect(await sqlstate(admin, change, [WA, UA])).toBeNull();
      await admin.query("rollback");
    }
  });

  it("a command that starts during an uncommitted demotion waits, then sees the demotion and is denied", async () => {
    const second = otherClient();
    await second.connect();
    try {
      await admin.query("begin");
      await admin.query(
        `update ${S}.memberships set role = 'viewer' where workspace_id = $1 and user_id = $2`,
        [WA, UA],
      );
      await second.query("begin");
      await setContext(second, ctxA);
      const pending = second
        .query(`select ${S}.create_item('races demotion')`)
        .then(
          () => null,
          (error: { code?: string }) => error.code,
        );
      await waitForLockWait("bru492-probe-runtime-2");
      await admin.query("commit");
      expect(await pending).toBe("42501");
      await second.query("rollback");
    } finally {
      await admin.query(
        `update ${S}.memberships set role = 'editor' where workspace_id = $1 and user_id = $2`,
        [WA, UA],
      );
      await second.end();
    }
  });

  it("FOR KEY SHARE would not serialize with a demotion, which is why commands use FOR SHARE", async () => {
    const holder = new pg.Client({
      ...env.db,
      application_name: "bru492-probe-holder",
    });
    await holder.connect();
    try {
      for (const [mode, expected] of [
        ["for key share", null],
        ["for share", "55P03"],
      ] as const) {
        await holder.query("begin");
        await holder.query(
          `select 1 from ${S}.memberships where workspace_id = $1 and user_id = $2 ${mode}`,
          [WA, UA],
        );
        await admin.query("begin");
        await admin.query("set local lock_timeout = '500ms'");
        expect(
          await sqlstate(
            admin,
            `update ${S}.memberships set role = 'viewer' where workspace_id = $1 and user_id = $2`,
            [WA, UA],
          ),
          mode,
        ).toBe(expected);
        await admin.query("rollback");
        await holder.query("rollback");
      }
    } finally {
      await holder.end();
    }
    const src = await admin.query(
      `select string_agg(prosrc, ' ') as s from pg_proc where pronamespace = $1::regnamespace and prosecdef`,
      [S],
    );
    expect(src.rows[0].s).toMatch(/for share/i);
    expect(src.rows[0].s).not.toMatch(/key share/i);
  });
});

describe("protected operation: fresh Auth outside the transaction, every retry reauthenticates", () => {
  const authAdmin = createClient(env.apiUrl, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const STORAGE_KEY = "sb-analyticool-auth";
  let userCalls = 0;
  const authOptions: SessionServerOptions = {
    apiUrl: env.apiUrl,
    publishableKey: env.publishableKey,
    storageKey: STORAGE_KEY,
    secure: true,
    absoluteLifetimeSeconds: EIGHT_HOURS,
    fetch: (input, init) => {
      if (new URL(String(input)).pathname === "/auth/v1/user") userCalls += 1;
      return globalThis.fetch(input, init);
    },
  };
  const authUsers: string[] = [];
  let pool: pg.Pool;

  /** Operator-created real GoTrue user with membership; returns its cookie header. */
  async function signedInMember(label: string, role: string) {
    const email = `bru492-op-${label}-${randomBytes(4).toString("hex")}@synthetic.invalid`;
    const password = `Synthetic-${randomBytes(12).toString("hex")}Aa1`;
    const { data, error } = await authAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(`createUser failed: ${error?.code}`);
    authUsers.push(data.user.id);
    await admin.query(`insert into ${S}.memberships values ($1, $2, $3)`, [
      WA,
      data.user.id,
      role,
    ]);
    const login = createRequestAuth(authOptions, undefined);
    const signIn = await login.supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signIn.error) throw new Error(`sign-in failed: ${signIn.error.code}`);
    const header = login.jar
      .flush()
      .setCookie.map((c) => c.split(";")[0] as string)
      .join("; ");
    expect(parseCookieHeader(header).length).toBeGreaterThan(0);
    return {
      userId: data.user.id,
      header,
      token: signIn.data.session?.access_token as string,
      // A NEW request-scoped client per call: nothing cached across attempts.
      authenticate: () => createRequestAuth(authOptions, header).authenticate(),
    };
  }
  const insertItem = (title: string) => async (c: pg.PoolClient) =>
    (await c.query(`select ${S}.create_item($1) as id`, [title])).rows[0]
      .id as string;
  const countTitle = async (title: string) =>
    (
      await admin.query(
        `select count(*)::int as n from ${S}.probe_items where title = $1`,
        [title],
      )
    ).rows[0].n;
  const assertNoAuthInsideTransactions = (events: OperationEvent[]) => {
    let open = false;
    for (const e of events) {
      if (e.type === "tx-begin") open = true;
      if (e.type === "tx-commit" || e.type === "tx-rollback") open = false;
      if (e.type === "auth-start") expect(open).toBe(false);
    }
  };

  beforeAll(() => {
    pool = new pg.Pool({ ...runtimeConfig("bru492-probe-op"), max: 2 });
  });
  afterAll(async () => {
    await pool?.end();
    for (const id of authUsers) await authAdmin.auth.admin.deleteUser(id);
  });

  it("binds the verified subject/session for attribution and never calls Auth while a transaction is open", async () => {
    const member = await signedInMember("ok", "editor");
    const events: OperationEvent[] = [];
    const before = userCalls;
    const result = await runProtectedOperation({
      authenticate: member.authenticate,
      pool,
      workspaceId: WA,
      maxAttempts: 3,
      body: insertItem("op-ok"),
      trace: (e) => events.push(e),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(userCalls - before).toBe(1);
    const row = await admin.query(
      `select created_by, created_session from ${S}.probe_items where id = $1`,
      [result.value],
    );
    expect(row.rows[0]).toEqual({
      created_by: member.userId,
      created_session: result.principal.sessionId,
    });
    expect(events.map((e) => e.type)).toEqual([
      "auth-start",
      "auth-end",
      "tx-begin",
      "tx-commit",
    ]);
    assertNoAuthInsideTransactions(events);
  });

  it("a serialization failure retries with a fresh getUser of the same token and commits exactly once", async () => {
    const member = await signedInMember("retry", "editor");
    const events: OperationEvent[] = [];
    const before = userCalls;
    const result = await runProtectedOperation({
      authenticate: member.authenticate,
      pool,
      workspaceId: WA,
      maxAttempts: 3,
      body: async (c, attempt) => {
        const id = await insertItem("op-retry")(c);
        if (attempt === 1)
          throw Object.assign(new Error("injected serialization failure"), {
            code: "40001",
          });
        return id;
      },
      trace: (e) => events.push(e),
    });
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(userCalls - before).toBe(2);
    expect(await countTitle("op-retry")).toBe(1);
    assertNoAuthInsideTransactions(events);
  });

  it("an external revocation between attempts denies the retry; nothing commits", async () => {
    const member = await signedInMember("revoked-retry", "editor");
    const result = await runProtectedOperation({
      authenticate: member.authenticate,
      pool,
      workspaceId: WA,
      maxAttempts: 3,
      body: async (c, attempt) => {
        await insertItem("op-revoked-retry")(c);
        if (attempt === 1) {
          expect(
            (await authAdmin.auth.admin.signOut(member.token, "global")).error,
          ).toBeNull();
          throw Object.assign(new Error("injected deadlock"), {
            code: "40P01",
          });
        }
        return "unexpected";
      },
    });
    expect(result).toEqual({
      ok: false,
      reason: "unauthenticated",
      attempts: 2,
    });
    expect(await countTitle("op-revoked-retry")).toBe(0);
  });

  it("accepted limit: a revocation racing an already-authorized attempt can commit; the next operation is denied", async () => {
    const member = await signedInMember("inflight", "editor");
    const first = await runProtectedOperation({
      authenticate: member.authenticate,
      pool,
      workspaceId: WA,
      maxAttempts: 1,
      body: async (c) => {
        const id = await insertItem("op-inflight")(c);
        await authAdmin.auth.admin.signOut(member.token, "global");
        return id;
      },
    });
    expect(first.ok).toBe(true);
    expect(await countTitle("op-inflight")).toBe(1);
    const next = await runProtectedOperation({
      authenticate: member.authenticate,
      pool,
      workspaceId: WA,
      maxAttempts: 1,
      body: insertItem("op-inflight-next"),
    });
    expect(next).toEqual({ ok: false, reason: "unauthenticated", attempts: 1 });
    expect(await countTitle("op-inflight-next")).toBe(0);
  });

  it("a demotion between attempts is enforced by the database on the reauthenticated retry", async () => {
    const member = await signedInMember("demoted-retry", "editor");
    await expect(
      runProtectedOperation({
        authenticate: member.authenticate,
        pool,
        workspaceId: WA,
        maxAttempts: 3,
        body: async (c, attempt) => {
          if (attempt === 1) {
            // No membership lock is held yet in this attempt.
            await admin.query(
              `update ${S}.memberships set role = 'viewer' where workspace_id = $1 and user_id = $2`,
              [WA, member.userId],
            );
            throw Object.assign(new Error("injected serialization failure"), {
              code: "40001",
            });
          }
          return insertItem("op-demoted-retry")(c);
        },
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await countTitle("op-demoted-retry")).toBe(0);
  });
});
