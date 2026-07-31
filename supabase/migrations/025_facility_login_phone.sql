-- ============================================================
-- HUUID Resolver — Migration 025: facility login phone (Layer 5)
--
-- huuid_facilities (migration 002) has no contact phone at all -- it
-- only ever needed facility_did/facility_name/certificate_status/
-- public_key_multibase for JWT verification. The Layer 3 approval flow
-- brief's "/facility/login" needs a phone to SMS an OTP to; the
-- authorised signatory's phone already lives on the originating
-- huuid_facility_applications row, but querying across that join on
-- every login felt like the wrong long-term shape (an application is a
-- one-time event, not a durable facility attribute) -- copying it onto
-- huuid_facilities at approval time instead, alongside every other
-- durable fact about an active facility.
-- ============================================================

ALTER TABLE huuid_facilities
  ADD COLUMN IF NOT EXISTS login_phone text;

GRANT SELECT, INSERT, UPDATE ON huuid_facilities TO service_role;
