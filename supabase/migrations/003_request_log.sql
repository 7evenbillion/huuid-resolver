-- ============================================================
-- HUUID Resolver — Migration 003: huuid_request_log
-- Replay-detection log for X-HUUID-Request-ID (Hours 61-80).
-- A request_id must not be reused within 24 hours (409 duplicateRequest).
-- ============================================================

CREATE TABLE huuid_request_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid UNIQUE NOT NULL,
  facility_did  text NOT NULL,
  logged_at     timestamptz NOT NULL DEFAULT now()
);

-- Explicitly requested composite index to serve the
-- "request_id + within last 24h" lookup pattern.
CREATE INDEX idx_huuid_request_log_request_id_logged_at
  ON huuid_request_log (request_id, logged_at);

-- ── RLS: enabled. Zero anon/authenticated access — server-side only. ──
ALTER TABLE huuid_request_log ENABLE ROW LEVEL SECURITY;

-- No policies for anon or authenticated: RLS-enabled + no policy = denied.
-- service_role bypasses RLS; capabilities are constrained by GRANTs below.

-- GRANTs (MANDATORY post May 30 2026 — silent permission-denied without)
-- Append-only log: service_role SELECT + INSERT only. No UPDATE. No DELETE.
GRANT SELECT, INSERT ON huuid_request_log TO service_role;
REVOKE ALL ON huuid_request_log FROM anon, authenticated;
