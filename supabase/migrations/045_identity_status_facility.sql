-- ============================================================
-- HUUID Resolver — Migration 045: Layer 7 support (patient-facing
-- identity status)
-- ============================================================

-- Which facility performed a Tier 2 in-person upgrade, so /my-huuid can
-- show "Verified at: [facility name]" instead of just the method code.
-- Nullable: the Smile ID face-match completion path (the callback in
-- app/api/smile-id/callback/route.ts) has no facility session to read
-- this from (it's an async webhook, not a facility-authenticated
-- request) and passes no value, defaulting to NULL there -- acceptable
-- since that path isn't reachable in this environment yet (Smile ID
-- unconfigured) and the UI falls back to generic wording when NULL.
ALTER TABLE huuid_patients
  ADD COLUMN IF NOT EXISTS identity_verified_facility_did text REFERENCES huuid_facilities(facility_did);

-- Adding a parameter changes the signature, so the old single-arg
-- overload must be dropped explicitly -- CREATE OR REPLACE only
-- replaces an exact signature match, it would otherwise leave both
-- overloads present.
DROP FUNCTION IF EXISTS huuid_complete_tier2_upgrade(text);

CREATE OR REPLACE FUNCTION huuid_complete_tier2_upgrade(p_huuid text, p_facility_did text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_patients
  SET verification_tier = 2,
      identity_verified = true,
      identity_verified_at = now(),
      identity_verified_method = 'facility_in_person',
      identity_verified_facility_did = p_facility_did
  WHERE huuid = p_huuid;
$$;

-- Everything /my-huuid's identity status UI needs in one call: tier,
-- verification metadata, and the verifying facility's name (joined,
-- never just its DID) when one is on file.
CREATE OR REPLACE FUNCTION huuid_get_identity_status(p_huuid text)
RETURNS TABLE (
  verification_tier integer,
  identity_verified boolean,
  identity_verified_method text,
  identity_verified_at timestamptz,
  identity_document_type text,
  identity_document_country text,
  identity_verified_facility_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    p.verification_tier,
    p.identity_verified,
    p.identity_verified_method,
    p.identity_verified_at,
    p.identity_document_type,
    p.identity_document_country,
    f.facility_name
  FROM huuid_patients p
  LEFT JOIN huuid_facilities f ON f.facility_did = p.identity_verified_facility_did
  WHERE p.huuid = p_huuid;
$$;

-- DROP + CREATE (not a true REPLACE of the same object, since the arg
-- list changed) means huuid_complete_tier2_upgrade lost its prior
-- grants and needs them reapplied.
REVOKE ALL ON FUNCTION huuid_complete_tier2_upgrade(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_complete_tier2_upgrade(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_complete_tier2_upgrade(text, text) TO service_role;

REVOKE ALL ON FUNCTION huuid_get_identity_status(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_get_identity_status(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_get_identity_status(text) TO service_role;
