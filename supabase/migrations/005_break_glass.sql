-- ============================================================
-- HUUID Resolver — Migration 005: Break-Glass (Month 3, Track B)
-- HUUID-BREAK-GLASS-API-v0.2. Four tables:
--   huuid_bg_audit_log        — separate, stricter audit trail (immutable)
--   huuid_bg_rate_limit       — 10/24h ceiling tracking
--   huuid_bg_notifications    — 60s patient-notification SLA tracking
--   huuid_facility_suspensions — Break-Glass-specific suspension (distinct
--                                 from huuid_facilities.certificate_status,
--                                 which governs standard resolution only)
-- ============================================================

-- ── Table 1: huuid_bg_audit_log (immutable — no UPDATE, no DELETE, ever) ──
CREATE TABLE huuid_bg_audit_log (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_entry_id          text UNIQUE NOT NULL,
  request_id              uuid NOT NULL,
  huuid                   text NOT NULL,
  clinician_did           text NOT NULL,
  clinician_license       text NOT NULL,
  facility_did            text NOT NULL,
  facility_code           text NOT NULL,
  reason_code             text NOT NULL
                          CHECK (reason_code IN ('cardiac_arrest', 'respiratory_failure',
                                                  'trauma', 'unconscious', 'anaphylaxis',
                                                  'stroke', 'other')),
  scope_requested         text[] NOT NULL,
  scope_granted           text[] NOT NULL,
  token_id                text NOT NULL,
  token_issued_at         timestamptz NOT NULL,
  token_expires_at        timestamptz NOT NULL,
  patient_notified        boolean NOT NULL DEFAULT false,
  notification_queued_at  timestamptz NULL,
  provider_cert_signature text NOT NULL,
  request_signature       text NOT NULL,
  ip_hash                 text NOT NULL,
  response_time_ms        integer NOT NULL,
  resolver_version        text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_huuid_bg_audit_log_facility_did ON huuid_bg_audit_log (facility_did);
CREATE INDEX idx_huuid_bg_audit_log_huuid ON huuid_bg_audit_log (huuid);
CREATE INDEX idx_huuid_bg_audit_log_created_at ON huuid_bg_audit_log (created_at);
CREATE INDEX idx_huuid_bg_audit_log_request_id ON huuid_bg_audit_log (request_id);

ALTER TABLE huuid_bg_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: RLS-enabled + no policy = denied.
-- service_role bypasses RLS; capabilities constrained by GRANTs below.
GRANT SELECT, INSERT ON huuid_bg_audit_log TO service_role;
REVOKE ALL ON huuid_bg_audit_log FROM anon, authenticated;

-- Belt-and-braces immutability, matching huuid_audit_log's pattern: block
-- UPDATE/DELETE at the database level even for roles that bypass RLS.
CREATE OR REPLACE FUNCTION huuid_bg_audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'huuid_bg_audit_log is immutable: % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER trg_huuid_bg_audit_log_no_update
  BEFORE UPDATE ON huuid_bg_audit_log
  FOR EACH ROW EXECUTE FUNCTION huuid_bg_audit_log_immutable();

CREATE TRIGGER trg_huuid_bg_audit_log_no_delete
  BEFORE DELETE ON huuid_bg_audit_log
  FOR EACH ROW EXECUTE FUNCTION huuid_bg_audit_log_immutable();

-- ── Table 2: huuid_bg_rate_limit ──
-- suspended is set true only on the triggering (10th) row at INSERT time —
-- no UPDATE grant is issued for this table (see api.md), so enforcement of
-- "suspended" going forward reads huuid_facility_suspensions.active, not
-- this table's suspended flag, which is a point-in-time annotation only.
CREATE TABLE huuid_bg_rate_limit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_did  text NOT NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  request_id    uuid NOT NULL,
  suspended     boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_huuid_bg_rate_limit_facility_triggered
  ON huuid_bg_rate_limit (facility_did, triggered_at);

ALTER TABLE huuid_bg_rate_limit ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON huuid_bg_rate_limit TO service_role;
REVOKE ALL ON huuid_bg_rate_limit FROM anon, authenticated;

-- ── Table 3: huuid_bg_notifications ──
CREATE TABLE huuid_bg_notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bg_audit_id    text NOT NULL REFERENCES huuid_bg_audit_log (audit_entry_id),
  channel        text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'guardian_sms', 'deferred')),
  status         text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'deferred')),
  queued_at      timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz NULL,
  retry_count    integer NOT NULL DEFAULT 0,
  recipient_hash text NOT NULL
);

CREATE INDEX idx_huuid_bg_notifications_bg_audit_id ON huuid_bg_notifications (bg_audit_id);
CREATE INDEX idx_huuid_bg_notifications_status ON huuid_bg_notifications (status);

ALTER TABLE huuid_bg_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON huuid_bg_notifications TO service_role;
REVOKE ALL ON huuid_bg_notifications FROM anon, authenticated;

-- ── Table 4: huuid_facility_suspensions ──
-- Break-Glass-specific suspension. Distinct from huuid_facilities
-- .certificate_status (Hours 61-80), which governs standard GET resolution
-- only — a facility can be fully active for standard resolution while its
-- Break-Glass capability specifically is suspended for rate-limit abuse.
CREATE TABLE huuid_facility_suspensions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_did   text NOT NULL,
  reason         text NOT NULL,
  suspended_at   timestamptz NOT NULL DEFAULT now(),
  suspended_by   text NOT NULL DEFAULT 'system',
  reinstated_at  timestamptz NULL,
  active         boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_huuid_facility_suspensions_facility_active
  ON huuid_facility_suspensions (facility_did, active);

ALTER TABLE huuid_facility_suspensions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON huuid_facility_suspensions TO service_role;
REVOKE ALL ON huuid_facility_suspensions FROM anon, authenticated;
