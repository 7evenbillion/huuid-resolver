-- ============================================================
-- HUUID Resolver — Migration 006: Stub Integrity Log (Month 4, P4)
-- Receives POST /1.0/stub-integrity alerts from EMR Stub installations
-- when a local process-integrity check (HMAC manifest + EdDSA signature
-- over src/scripts files, see huuid-emr-stub's integrity-check.ts) detects
-- a mismatch against the facility's own signed baseline.
--
-- NOTE (Month 4 scope): this table only LOGS what a Stub reports. The
-- receiving endpoint does not yet verify `signature` against the
-- reporting facility's public key (huuid_facilities.public_key_multibase)
-- before writing the row -- see app/api/1.0/stub-integrity/route.ts's
-- file-level comment. Flagged as a real, intentional gap for this step,
-- not an oversight.
-- ============================================================

CREATE TABLE huuid_stub_integrity_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_did   text NOT NULL,
  manifest_hash  text NOT NULL,
  stub_version   text NOT NULL,
  reported_at    timestamptz NOT NULL DEFAULT now(),
  violation      boolean NOT NULL,
  ip_hash        text NOT NULL
);

CREATE INDEX idx_huuid_stub_integrity_log_facility_did ON huuid_stub_integrity_log (facility_did);
CREATE INDEX idx_huuid_stub_integrity_log_reported_at ON huuid_stub_integrity_log (reported_at);
CREATE INDEX idx_huuid_stub_integrity_log_violation ON huuid_stub_integrity_log (violation);

-- ── RLS: enabled. Zero anon/authenticated access — server-side only. ──
ALTER TABLE huuid_stub_integrity_log ENABLE ROW LEVEL SECURITY;

-- No policies for anon or authenticated: RLS-enabled + no policy = denied.
-- service_role bypasses RLS; capabilities are constrained by GRANTs below.

-- GRANTs (MANDATORY post May 30 2026 — silent permission-denied without)
-- service_role: SELECT, INSERT only. No UPDATE, no DELETE — this is an
-- append-only report log, not (yet) declared formally immutable with a
-- trigger the way huuid_audit_log/huuid_bg_audit_log are; revisit if this
-- log becomes evidentiary rather than operational/diagnostic.
GRANT SELECT, INSERT ON huuid_stub_integrity_log TO service_role;
REVOKE ALL ON huuid_stub_integrity_log FROM anon, authenticated;
