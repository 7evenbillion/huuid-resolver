-- ============================================================
-- HUUID Resolver — Migration 007: Stub Integrity Signature Verification
-- (Gap 2 closure, Month 4)
-- Existing rows predate signature verification and are backfilled false
-- by the DEFAULT clause below (Postgres applies the default to all
-- existing rows when adding a NOT NULL column with a constant default —
-- no separate UPDATE statement needed for that; verified after applying).
-- ============================================================

ALTER TABLE huuid_stub_integrity_log
ADD COLUMN signature_verified boolean not null default false;
