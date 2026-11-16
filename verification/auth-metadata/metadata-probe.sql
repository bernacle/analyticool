-- BRU-492 preparation: metadata authorization PATTERN probe (accepted ADR §3/§5).
-- NOT the production metric schema: generic probe_items only, no metric,
-- lifecycle, version, approval or publication features. Applied to the
-- disposable local Supabase Postgres by metadata-rls.test.ts as the
-- hosted-realistic migration credential `postgres` (non-superuser), which
-- also stands in for separately privileged operator tooling. The test creates
-- the LOGIN runtime role (with a per-run random password) before this file.
--
-- Contract exercised:
-- * NOLOGIN/NOBYPASSRLS owner of every object; FORCE RLS on every table, so
--   the owner (and therefore every SECURITY DEFINER command) obeys policies.
-- * Runtime: LOGIN, NOBYPASSRLS, NOINHERIT, member of no role, owns nothing;
--   SELECT on readable tables and EXECUTE on a small set of commands only.
-- * Context = transaction-local GUCs issued by the trusted backend after a
--   fresh Supabase Auth validation. Missing/malformed context denies.
-- * Membership policy: own rows only, from verified context alone. Item
--   policies look up that member row; no helper reads a table, so there is no
--   policy recursion and no definer helper inside policies.
-- * Commands lock the caller's membership row FOR SHARE (conflicts with an
--   operator demotion UPDATE and a revocation DELETE; FOR KEY SHARE would not
--   conflict with the demotion).
-- * No access to managed Auth tables; no BYPASSRLS anywhere in this pattern.

create role bru492_probe_owner nologin nobypassrls noinherit;
grant bru492_probe_owner to postgres with set true, inherit false;

create schema bru492_probe authorization bru492_probe_owner;
revoke all on schema bru492_probe from public;

set role bru492_probe_owner;

create table bru492_probe.workspaces (id uuid primary key);

create table bru492_probe.memberships (
  workspace_id uuid not null references bru492_probe.workspaces (id),
  user_id uuid not null,
  role text not null check (role in ('viewer', 'editor', 'admin')),
  primary key (workspace_id, user_id)
);

create table bru492_probe.probe_items (
  workspace_id uuid not null references bru492_probe.workspaces (id),
  id uuid not null default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  created_by uuid not null,
  created_session uuid not null,
  primary key (workspace_id, id)
);

create table bru492_probe.probe_item_notes (
  workspace_id uuid not null,
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  body text not null check (length(body) between 1 and 500),
  created_by uuid not null,
  primary key (workspace_id, id),
  foreign key (workspace_id, item_id)
    references bru492_probe.probe_items (workspace_id, id)
);

-- Context helpers: SECURITY INVOKER, read only the GUC, never a table.
create function bru492_probe.context_uuid(p_name text) returns uuid
  language sql stable security invoker
  set search_path = pg_catalog, pg_temp
as $$
  select case
    when s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then s::uuid
  end
  from (select pg_catalog.current_setting(p_name, true) as s) as setting
$$;
create function bru492_probe.ctx_user() returns uuid
  language sql stable security invoker set search_path = pg_catalog, pg_temp
as $$ select bru492_probe.context_uuid('analyticool.user_id') $$;
create function bru492_probe.ctx_session() returns uuid
  language sql stable security invoker set search_path = pg_catalog, pg_temp
as $$ select bru492_probe.context_uuid('analyticool.session_id') $$;
create function bru492_probe.ctx_workspace() returns uuid
  language sql stable security invoker set search_path = pg_catalog, pg_temp
as $$ select bru492_probe.context_uuid('analyticool.workspace_id') $$;

alter table bru492_probe.workspaces enable row level security;
alter table bru492_probe.workspaces force row level security;
alter table bru492_probe.memberships enable row level security;
alter table bru492_probe.memberships force row level security;
alter table bru492_probe.probe_items enable row level security;
alter table bru492_probe.probe_items force row level security;
alter table bru492_probe.probe_item_notes enable row level security;
alter table bru492_probe.probe_item_notes force row level security;

-- No policy on workspaces: nobody but the operator path reads it directly.

create policy memberships_own on bru492_probe.memberships
  for select to bru492_probe_owner, bru492_probe_runtime
  using (user_id = bru492_probe.ctx_user()
         and bru492_probe.ctx_session() is not null);
-- Lets the owner's commands take FOR SHARE on the caller's own current row,
-- never change it.
create policy memberships_own_lock on bru492_probe.memberships
  for update to bru492_probe_owner
  using (user_id = bru492_probe.ctx_user()
         and workspace_id = bru492_probe.ctx_workspace())
  with check (false);

create policy items_member_read on bru492_probe.probe_items
  for select to bru492_probe_owner, bru492_probe_runtime
  using (workspace_id = bru492_probe.ctx_workspace()
         and bru492_probe.ctx_session() is not null
         and exists (select 1 from bru492_probe.memberships m
                      where m.workspace_id = probe_items.workspace_id
                        and m.user_id = bru492_probe.ctx_user()));
create policy items_writer_insert on bru492_probe.probe_items
  for insert to bru492_probe_owner
  with check (workspace_id = bru492_probe.ctx_workspace()
              and created_by = bru492_probe.ctx_user()
              and created_session = bru492_probe.ctx_session()
              and exists (select 1 from bru492_probe.memberships m
                           where m.workspace_id = probe_items.workspace_id
                             and m.user_id = bru492_probe.ctx_user()
                             and m.role in ('editor', 'admin')));

create policy notes_member_read on bru492_probe.probe_item_notes
  for select to bru492_probe_owner, bru492_probe_runtime
  using (workspace_id = bru492_probe.ctx_workspace()
         and bru492_probe.ctx_session() is not null
         and exists (select 1 from bru492_probe.memberships m
                      where m.workspace_id = probe_item_notes.workspace_id
                        and m.user_id = bru492_probe.ctx_user()));
create policy notes_writer_insert on bru492_probe.probe_item_notes
  for insert to bru492_probe_owner
  with check (workspace_id = bru492_probe.ctx_workspace()
              and created_by = bru492_probe.ctx_user()
              and exists (select 1 from bru492_probe.memberships m
                           where m.workspace_id = probe_item_notes.workspace_id
                             and m.user_id = bru492_probe.ctx_user()
                             and m.role in ('editor', 'admin')));

-- Commands: fixed safe search_path, schema-qualified references, scope and
-- role taken only from verified context (no workspace/actor/role parameters).
create function bru492_probe.create_item(p_title text) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  v_user uuid := bru492_probe.ctx_user();
  v_session uuid := bru492_probe.ctx_session();
  v_workspace uuid := bru492_probe.ctx_workspace();
  v_role text;
  v_id uuid;
begin
  if v_user is null or v_session is null or v_workspace is null then
    raise exception 'access denied' using errcode = '42501';
  end if;
  select m.role into v_role
    from bru492_probe.memberships m
   where m.workspace_id = v_workspace and m.user_id = v_user
     for share;
  if v_role is null or v_role not in ('editor', 'admin') then
    raise exception 'access denied' using errcode = '42501';
  end if;
  insert into bru492_probe.probe_items (workspace_id, title, created_by, created_session)
  values (v_workspace, p_title, v_user, v_session)
  returning id into v_id;
  return v_id;
end
$$;

create function bru492_probe.add_note(p_item uuid, p_body text) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  v_user uuid := bru492_probe.ctx_user();
  v_workspace uuid := bru492_probe.ctx_workspace();
  v_role text;
  v_id uuid;
begin
  if v_user is null or bru492_probe.ctx_session() is null or v_workspace is null then
    raise exception 'access denied' using errcode = '42501';
  end if;
  select m.role into v_role
    from bru492_probe.memberships m
   where m.workspace_id = v_workspace and m.user_id = v_user
     for share;
  if v_role is null or v_role not in ('editor', 'admin') then
    raise exception 'access denied' using errcode = '42501';
  end if;
  -- Foreign and missing items share one response.
  if not exists (select 1 from bru492_probe.probe_items i
                  where i.workspace_id = v_workspace and i.id = p_item) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  insert into bru492_probe.probe_item_notes (workspace_id, item_id, body, created_by)
  values (v_workspace, p_item, p_body, v_user)
  returning id into v_id;
  return v_id;
end
$$;

revoke all on all functions in schema bru492_probe from public;
grant usage on schema bru492_probe to bru492_probe_runtime;
grant select on bru492_probe.memberships, bru492_probe.probe_items,
  bru492_probe.probe_item_notes to bru492_probe_runtime;
grant execute on function bru492_probe.context_uuid(text), bru492_probe.ctx_user(),
  bru492_probe.ctx_session(), bru492_probe.ctx_workspace(),
  bru492_probe.create_item(text), bru492_probe.add_note(uuid, text)
  to bru492_probe_runtime;
-- Operator tooling (here the BYPASSRLS migration credential) provisions
-- workspaces and memberships; the runtime cannot.
grant select, insert, update, delete on bru492_probe.workspaces,
  bru492_probe.memberships to postgres;
grant select, insert on bru492_probe.probe_items, bru492_probe.probe_item_notes
  to postgres;

reset role;
