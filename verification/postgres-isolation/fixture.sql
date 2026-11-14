-- BRU-461 synthetic two-tenant fixture. Loaded by a superuser after schema.sql.
-- All rows are fictional. Orbit amounts are unique sentinels (999999, 424242,
-- 12345, 13579, 7777) that must never appear in an Acme-scoped result.
-- Every ID is prefixed with its owning tenant ("acme-" / "orbit-").

INSERT INTO analyticool_private.charges (id, tenant_id, amount_cents, currency, created_at) VALUES
  ('acme-ch-1', 'fictional-acme', 10000, 'USD', '2026-01-10T12:00:00Z'),
  ('acme-ch-2', 'fictional-acme', 20000, 'USD', '2026-01-31T23:30:00-02:00'),
  ('acme-ch-3', 'fictional-acme', 30000, 'USD', '2026-06-30T18:00:00Z'),
  ('orbit-ch-1', 'fictional-orbit', 999999, 'USD', '2026-02-14T09:00:00Z'),
  ('orbit-ch-2', 'fictional-orbit', 424242, 'USD', '2026-03-02T09:00:00Z');

INSERT INTO analyticool_private.payments (id, charge_id, status, paid_at) VALUES
  ('acme-pay-1', 'acme-ch-1', 'captured', '2026-01-10T12:00:00Z'),
  ('acme-pay-2', 'acme-ch-2', 'captured', '2026-01-31T23:30:00-02:00'),
  ('acme-pay-3', 'acme-ch-3', 'captured', '2026-06-30T18:00:00Z'),
  ('orbit-pay-1', 'orbit-ch-1', 'captured', '2026-02-14T09:00:00Z'),
  ('orbit-pay-2', 'orbit-ch-2', 'failed', '2026-03-02T09:00:00Z');

INSERT INTO analyticool_private.refunds (id, tenant_id, payment_id, status, settled_at, amount_cents) VALUES
  ('acme-ref-1', 'fictional-acme', 'acme-pay-1', 'settled', '2026-02-03T10:00:00Z', 1000),
  ('acme-ref-2', 'fictional-acme', 'acme-pay-1', 'settled', '2026-02-20T10:00:00Z', 500),
  -- Cross-tenant parent: an Acme adjustment pointing at an Orbit payment.
  ('acme-ref-cross', 'fictional-acme', 'orbit-pay-1', 'settled', '2026-03-01T10:00:00Z', 4120),
  ('orbit-ref-1', 'fictional-orbit', 'orbit-pay-1', 'settled', '2026-02-20T10:00:00Z', 12345),
  -- Reverse direction: an Orbit adjustment pointing at an Acme payment.
  ('orbit-ref-reverse', 'fictional-orbit', 'acme-pay-1', 'settled', '2026-02-21T10:00:00Z', 13579);

INSERT INTO analyticool_private.processing_fees (id, tenant_id, payment_id, status, posted_at, amount_cents) VALUES
  ('acme-fee-1', 'fictional-acme', 'acme-pay-1', 'posted', '2026-01-10T12:00:00Z', 300),
  ('acme-fee-2', 'fictional-acme', 'acme-pay-1', 'posted', '2026-01-11T12:00:00Z', 50),
  ('orbit-fee-1', 'fictional-orbit', 'orbit-pay-1', 'posted', '2026-02-14T09:00:00Z', 7777);
