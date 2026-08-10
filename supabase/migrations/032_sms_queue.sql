-- ============================================================
-- HUUID Resolver — Migration 032: SMS burst-throttling fix
--
-- Diagnosis (2026-08-09, see HANDOFF.md §19.4.4): Hubtel's quick-send API
-- returns status:0 (accepted) and its own status-check endpoint often
-- reports "Delivered" regardless, but messages sent in rapid succession to
-- the same recipient are silently dropped before reaching the handset.
-- Two real, human-paced OTP sends (enrollment, login) arrived; four
-- machine-speed follow-up sends within the same ~20-minute window did not,
-- with and without a URL in the content -- ruling out link filtering as
-- the cause and pointing at burst/rate throttling on Hubtel's or the
-- carrier's side instead. This project already has one prior, independent
-- instance of the same failure mode (a 4-second sleep between two
-- back-to-back sends in the facility-approval flow, added for the exact
-- same reason, unrelated to this account).
--
-- Fix: OTP sends (patient-safety-critical, time-sensitive) go out
-- immediately, never queued. Every other notification is queued and
-- dispatched by a separate cron-triggered route with real spacing
-- (minimum 30s from any prior send to that phone_hash when queued, a
-- further 5s floor enforced again at dispatch time) rather than trusting
-- the API's own accept response as proof of delivery.
-- ============================================================

CREATE TABLE huuid_sms_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  hubtel_message_id text,
  priority text NOT NULL CHECK (priority IN ('critical', 'normal'))
);

CREATE INDEX idx_sms_send_log_phone_time
  ON huuid_sms_send_log (phone_hash, sent_at DESC);

ALTER TABLE huuid_sms_send_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON huuid_sms_send_log TO service_role;
REVOKE ALL ON huuid_sms_send_log FROM anon, authenticated;

CREATE POLICY huuid_sms_send_log_service ON huuid_sms_send_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE huuid_sms_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash text NOT NULL,
  phone_encrypted text NOT NULL,
  message text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('critical', 'normal')),
  scheduled_for timestamptz NOT NULL,
  sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  hubtel_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_queue_scheduled
  ON huuid_sms_queue (scheduled_for, sent)
  WHERE sent = false;

ALTER TABLE huuid_sms_queue ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON huuid_sms_queue TO service_role;
REVOKE ALL ON huuid_sms_queue FROM anon, authenticated;

CREATE POLICY huuid_sms_queue_service ON huuid_sms_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- Fix 4 support: OTP delivery audit.
--
-- hubtel_message_id lets a critical-priority OTP send be correlated back
-- to its own Hubtel messageId (set by the calling route right after
-- sendSMS() returns). undelivered_flagged is a one-shot guard so the
-- per-minute dispatcher run only ever writes one audit entry per OTP,
-- not one every minute forever once the 10-minute window has passed.
-- ------------------------------------------------------------

ALTER TABLE huuid_otp_verifications
  ADD COLUMN hubtel_message_id text,
  ADD COLUMN undelivered_flagged boolean NOT NULL DEFAULT false;

-- huuid_audit_enrollment gets a structured `details` column (this is the
-- first action needing more than the existing outcome/ip_hash/
-- user_agent_hash fields can hold) plus the new action itself.
ALTER TABLE huuid_audit_enrollment
  ADD COLUMN details jsonb;

ALTER TABLE huuid_audit_enrollment DROP CONSTRAINT huuid_audit_enrollment_action_check;
ALTER TABLE huuid_audit_enrollment ADD CONSTRAINT huuid_audit_enrollment_action_check
  CHECK (action IN (
    'enrollment_started',
    'phone_verified',
    'keypair_generated',
    'enrollment_completed',
    'card_downloaded',
    'recovery_requested',
    'erasure_requested',
    'erasure_completed',
    'medical_profile_updated',
    'profile_updated',
    'pin_changed',
    'otp_possibly_undelivered'
  ));
