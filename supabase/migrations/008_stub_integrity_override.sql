-- ============================================================
-- HUUID Resolver — Migration 008: Stub Integrity Override Flag
-- (Extra gap found while closing Gap 2, Month 4)
--
-- Gap 2's own DoD item 4 requires an override alert (Gap 1, the Stub's
-- emergency-override startup flow) to be "logged with override: true" --
-- but huuid_stub_integrity_log had no column to hold that, and Gap 2's
-- stated migration (007) didn't add one either. Per "new gaps get fixed,
-- not documented away," this is fixed here rather than silently dropping
-- the override flag on the floor when a real alert carries it.
-- ============================================================

ALTER TABLE huuid_stub_integrity_log
ADD COLUMN override boolean not null default false;
