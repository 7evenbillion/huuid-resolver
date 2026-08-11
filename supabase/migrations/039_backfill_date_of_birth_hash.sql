-- ============================================================
-- HUUID Resolver — Migration 039: fix + backfill date_of_birth_hash
--
-- Bug found via live verification against production (2026-08-10):
-- migration 036 added date_of_birth_hash but nothing ever populated it --
-- not for the 4 existing patients (added before this column existed),
-- and not for new enrollments either (huuid_enroll_patient, migration
-- 013, has no date_of_birth_hash parameter, and /api/enroll/register
-- never called huuid_set_date_of_birth_hash after insert). Result: dedup
-- Layer 2's huuid_find_dob_candidates could never match anyone --
-- confirmed by a live POST against production returning
-- potentialDuplicate:false for a deliberately near-duplicate name/DOB
-- that should have matched. Two fixes:
--
-- 1. This backfill RPC, run once against the 4 existing rows below.
-- 2. app/api/enroll/register/route.ts now calls huuid_set_date_of_birth_
--    hash for every new enrollment (application code, this commit).
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_backfill_date_of_birth_hashes(p_pii_key text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE huuid_patients
  SET date_of_birth_hash = huuid_hash_dob(pgp_sym_decrypt(date_of_birth_enc, p_pii_key)::date, p_pii_key)
  WHERE date_of_birth_hash IS NULL AND date_of_birth_enc IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION huuid_backfill_date_of_birth_hashes(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_backfill_date_of_birth_hashes(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_backfill_date_of_birth_hashes(text) TO service_role;
