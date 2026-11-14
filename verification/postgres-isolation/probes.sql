-- Verification-only additions, loaded after schema.sql in the test database.
-- NOT part of the reference contract and never listed in the core allowlist.
-- A deliberately slow tenant-scoped view lets the suite prove that the
-- executor's statement_timeout cancels a planned query.
SET ROLE analyticool_owner;
CREATE VIEW analyticool_api.verification_slow_charges WITH (security_barrier = true, security_invoker = false) AS
  SELECT c.id, c.amount_cents, c.created_at
  FROM analyticool_private.charges c
  WHERE c.tenant_id = nullif(current_setting('analyticool.tenant_id', true), '')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_sleep(2));
RESET ROLE;
REVOKE ALL ON analyticool_api.verification_slow_charges FROM PUBLIC;
GRANT SELECT ON analyticool_api.verification_slow_charges TO analyticool_reader;
