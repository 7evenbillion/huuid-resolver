-- ============================================================
-- HUUID Resolver — Migration 038: Layer 2 support
--
-- Single small RPC: huuid_enroll_patient (migration 013) doesn't take an
-- enrolling-facility parameter, and its signature is depended on by the
-- existing, already-verified self-enrollment and facility-enrollment
-- flows -- rather than touching that RPC, /api/enroll/register calls this
-- immediately after a successful insert, only when the session carries
-- witnessingFacilityDid (Layer 7). Populates enrolling_facility_did
-- (migration 036) so T2 ("issuing node match") has real data to score
-- against for future enrollments.
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_set_enrolling_facility_did(p_huuid text, p_facility_did text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_patients SET enrolling_facility_did = p_facility_did WHERE huuid = p_huuid;
$$;

REVOKE ALL ON FUNCTION huuid_set_enrolling_facility_did(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_set_enrolling_facility_did(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_set_enrolling_facility_did(text, text) TO service_role;
