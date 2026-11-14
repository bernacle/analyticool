-- BRU-461 reference schema: synthetic data only, PostgreSQL 16+.
-- Run as a superuser inside a dedicated, disposable database. Role names are
-- cluster-wide; point this only at a throwaway test cluster.
--
-- Layer 3 of docs/architecture/postgres-tenant-boundaries.md:
--   analyticool_owner  NOLOGIN, owns schemas/tables/views; never used by the app.
--   analyticool_reader NOLOGIN group: USAGE on analyticool_api, SELECT on views only.
--   analyticool_app    LOGIN, member of reader only; no superuser, CREATEDB,
--                      CREATEROLE, REPLICATION or BYPASSRLS; owns nothing;
--                      read-only by default. Its password is set by the caller.
-- Base tables have ENABLE + FORCE row-level security with SELECT-only policies
-- that fail closed when the tenant setting is missing or empty.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analyticool_owner') THEN
    CREATE ROLE analyticool_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analyticool_reader') THEN
    CREATE ROLE analyticool_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analyticool_app') THEN
    CREATE ROLE analyticool_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 20;
  END IF;
END
$$;

ALTER ROLE analyticool_app SET default_transaction_read_only = on;
ALTER ROLE analyticool_app SET statement_timeout = '5s';
ALTER ROLE analyticool_app SET lock_timeout = '1s';
ALTER ROLE analyticool_app SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE analyticool_app SET search_path = pg_catalog;
GRANT analyticool_reader TO analyticool_app;

-- Database and public schema: no CONNECT/TEMP/CREATE for PUBLIC.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO analyticool_app', current_database());
END
$$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA analyticool_private AUTHORIZATION analyticool_owner;
CREATE SCHEMA analyticool_api AUTHORIZATION analyticool_owner;
REVOKE ALL ON SCHEMA analyticool_private FROM PUBLIC;
REVOKE ALL ON SCHEMA analyticool_api FROM PUBLIC;
GRANT USAGE ON SCHEMA analyticool_api TO analyticool_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE analyticool_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE analyticool_owner REVOKE ALL ON TABLES FROM PUBLIC;

SET ROLE analyticool_owner;

CREATE TABLE analyticool_private.charges (
  id text PRIMARY KEY,
  tenant_id text NOT NULL CHECK (tenant_id <> ''),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  created_at timestamptz NOT NULL
);
-- Payments carry no tenant column: they inherit ownership from their charge.
CREATE TABLE analyticool_private.payments (
  id text PRIMARY KEY,
  charge_id text NOT NULL REFERENCES analyticool_private.charges (id),
  status text NOT NULL CHECK (status IN ('captured', 'failed')),
  paid_at timestamptz NOT NULL
);
-- Adjustments carry their own tenant and an independently scoped parent.
CREATE TABLE analyticool_private.refunds (
  id text PRIMARY KEY,
  tenant_id text NOT NULL CHECK (tenant_id <> ''),
  payment_id text NOT NULL REFERENCES analyticool_private.payments (id),
  status text NOT NULL CHECK (status IN ('settled', 'pending', 'failed')),
  settled_at timestamptz NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0)
);
CREATE TABLE analyticool_private.processing_fees (
  id text PRIMARY KEY,
  tenant_id text NOT NULL CHECK (tenant_id <> ''),
  payment_id text NOT NULL REFERENCES analyticool_private.payments (id),
  status text NOT NULL CHECK (status IN ('posted', 'pending')),
  posted_at timestamptz NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0)
);
CREATE INDEX ON analyticool_private.charges (tenant_id, created_at);
CREATE INDEX ON analyticool_private.payments (charge_id);
CREATE INDEX ON analyticool_private.refunds (tenant_id, settled_at);
CREATE INDEX ON analyticool_private.processing_fees (tenant_id, posted_at);

-- FORCE applies the policies to the owner too, so owner-privileged views stay
-- scoped. Only SELECT policies exist: every write is denied by default.
ALTER TABLE analyticool_private.charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyticool_private.charges FORCE ROW LEVEL SECURITY;
ALTER TABLE analyticool_private.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyticool_private.payments FORCE ROW LEVEL SECURITY;
ALTER TABLE analyticool_private.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyticool_private.refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE analyticool_private.processing_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyticool_private.processing_fees FORCE ROW LEVEL SECURITY;

-- nullif(..., '') makes a missing, reset or empty setting match nothing.
CREATE POLICY tenant_isolation ON analyticool_private.charges FOR SELECT TO PUBLIC
  USING (tenant_id = nullif(current_setting('analyticool.tenant_id', true), ''));
CREATE POLICY tenant_isolation ON analyticool_private.payments FOR SELECT TO PUBLIC
  USING (EXISTS (
    SELECT 1 FROM analyticool_private.charges c
    WHERE c.id = charge_id
      AND c.tenant_id = nullif(current_setting('analyticool.tenant_id', true), '')
  ));
CREATE POLICY tenant_isolation ON analyticool_private.refunds FOR SELECT TO PUBLIC
  USING (tenant_id = nullif(current_setting('analyticool.tenant_id', true), ''));
CREATE POLICY tenant_isolation ON analyticool_private.processing_fees FOR SELECT TO PUBLIC
  USING (tenant_id = nullif(current_setting('analyticool.tenant_id', true), ''));

-- The only relations the application can read. Owner-privileged
-- (security_invoker = false) so base tables need no grant to the app;
-- security_barrier so caller predicates cannot run before the tenant filter.
-- Views repeat the tenant filter; RLS still applies underneath (defense in depth).
CREATE VIEW analyticool_api.charges WITH (security_barrier = true, security_invoker = false) AS
  SELECT c.id, c.amount_cents, c.currency, c.created_at
  FROM analyticool_private.charges c
  WHERE c.tenant_id = nullif(current_setting('analyticool.tenant_id', true), '');
CREATE VIEW analyticool_api.payments WITH (security_barrier = true, security_invoker = false) AS
  SELECT p.id, p.charge_id, p.status, p.paid_at, c.amount_cents
  FROM analyticool_private.payments p
  JOIN analyticool_private.charges c ON c.id = p.charge_id
  WHERE c.tenant_id = nullif(current_setting('analyticool.tenant_id', true), '');
CREATE VIEW analyticool_api.refunds WITH (security_barrier = true, security_invoker = false) AS
  SELECT r.id, r.payment_id, r.status, r.settled_at, r.amount_cents
  FROM analyticool_private.refunds r
  WHERE r.tenant_id = nullif(current_setting('analyticool.tenant_id', true), '');
CREATE VIEW analyticool_api.processing_fees WITH (security_barrier = true, security_invoker = false) AS
  SELECT f.id, f.payment_id, f.status, f.posted_at, f.amount_cents
  FROM analyticool_private.processing_fees f
  WHERE f.tenant_id = nullif(current_setting('analyticool.tenant_id', true), '');

RESET ROLE;

REVOKE ALL ON ALL TABLES IN SCHEMA analyticool_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA analyticool_api FROM PUBLIC;
GRANT SELECT ON analyticool_api.charges, analyticool_api.payments,
  analyticool_api.refunds, analyticool_api.processing_fees TO analyticool_reader;

-- Server file access, large objects, dblink, advisory locks and backend
-- signalling: no EXECUTE for PUBLIC in this database. Several are already
-- superuser-only; revoking explicitly keeps the contract checkable.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    WHERE p.proname = ANY (ARRAY[
        'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
        'lo_import', 'lo_export', 'lo_create', 'lo_creat', 'lo_from_bytea',
        'lo_put', 'lo_get', 'lo_unlink', 'lo_open', 'lo_close', 'loread',
        'lowrite', 'lo_lseek', 'lo_lseek64', 'lo_tell', 'lo_tell64',
        'lo_truncate', 'lo_truncate64',
        'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf'])
      OR p.proname LIKE 'dblink%'
      OR p.proname LIKE 'pg_advisory%'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
  END LOOP;
END
$$;
