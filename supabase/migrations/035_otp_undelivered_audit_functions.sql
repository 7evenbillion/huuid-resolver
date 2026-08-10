-- ============================================================
-- HUUID Resolver — Migration 035: OTP undelivered-audit RPCs (Fix 4)
--
-- Companion to 032 (which added huuid_otp_verifications.hubtel_message_id
-- and .undelivered_flagged). huuid_otp_create already RETURNS uuid, so the
-- calling route can capture the new row's id and attach the real Hubtel
-- messageId once sendSMS() returns. huuid_otp_find_undelivered is polled
-- once per dispatcher run (app/api/sms-dispatch) to catch OTPs that were
-- sent (a real messageId exists) but never used within the 10-minute
-- expiry window -- visibility only, no automatic retry, per spec.
--
-- Scoped to the four otp_type values actually persisted in this table
-- (enrollment, recovery, login, erasure). Admin login and facility login
-- OTPs live only in an ephemeral encrypted cookie, never a queryable
-- table, and the credential-download OTP lives in a different table
-- (huuid_facility_credential_deliveries) -- none of those three can be
-- covered by this mechanism without separate plumbing.
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_otp_set_message_id(p_id uuid, p_hubtel_message_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_otp_verifications
  SET hubtel_message_id = p_hubtel_message_id
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION huuid_otp_find_undelivered(p_cutoff_minutes integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  phone_hash text,
  hubtel_message_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT v.id, v.phone_hash, v.hubtel_message_id
  FROM huuid_otp_verifications v
  WHERE v.used = false
    AND v.undelivered_flagged = false
    AND v.hubtel_message_id IS NOT NULL
    AND v.created_at < now() - (p_cutoff_minutes || ' minutes')::interval
    AND v.otp_type IN ('enrollment', 'recovery', 'login', 'erasure')
  LIMIT 25;
$$;

CREATE OR REPLACE FUNCTION huuid_otp_flag_undelivered(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_otp_verifications
  SET undelivered_flagged = true
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION huuid_otp_set_message_id(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_otp_find_undelivered(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_otp_flag_undelivered(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_otp_set_message_id(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_otp_find_undelivered(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_otp_flag_undelivered(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_otp_set_message_id(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_otp_find_undelivered(integer) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_otp_flag_undelivered(uuid) TO service_role;
