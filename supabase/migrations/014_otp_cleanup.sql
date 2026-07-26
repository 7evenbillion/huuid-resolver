-- ============================================================
-- HUUID Resolver — Migration 014: OTP cleanup
-- Renumbered from the spec's 013 (013 is now patient_enrollment, since
-- 012 was already taken by 012_waitlist.sql — see 013's header note).
--
-- Storage limitation (privacy-by-design principle from the enrollment
-- brief): used OTPs older than 24h are deleted, not retained indefinitely.
-- Unused/expired-but-never-used OTPs are also swept once they're 24h past
-- expiry, so a phone number's OTP history doesn't accumulate forever
-- either way.
--
-- Supabase has no built-in cron by default in this project (no pg_cron
-- usage anywhere else in this codebase) -- this function is written to be
-- invoked by an external scheduled trigger (a Vercel Cron Job hitting a
-- protected route, or pg_cron if it's enabled later on this shared
-- project). Defining the function here regardless, since the cleanup
-- logic itself is what matters and how it's invoked can change without a
-- new migration.
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_cleanup_expired_otps()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM huuid_otp_verifications
  WHERE (used = true AND created_at < now() - interval '24 hours')
     OR (used = false AND expires_at < now() - interval '24 hours');
END;
$$;

REVOKE ALL ON FUNCTION huuid_cleanup_expired_otps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_cleanup_expired_otps() TO service_role;
REVOKE EXECUTE ON FUNCTION huuid_cleanup_expired_otps() FROM anon, authenticated;
