-- ============================================================
-- HUUID Resolver — Migration 044: Layer 6 support (Root Authority
-- duplicate management)
-- ============================================================

-- Decrypts both sides of each flagged pair for the side-by-side review
-- UI. phone is truncated to last 4 digits inside the function so the
-- full number never needs to leave the database for this screen.
CREATE OR REPLACE FUNCTION huuid_list_potential_duplicates(p_pii_key text)
RETURNS TABLE (
  new_huuid text,
  new_full_name text,
  new_verification_tier integer,
  new_created_at timestamptz,
  new_phone_last4 text,
  existing_huuid text,
  existing_full_name text,
  existing_verification_tier integer,
  existing_created_at timestamptz,
  existing_phone_last4 text,
  pms_score numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    n.huuid,
    pgp_sym_decrypt(n.full_name_enc, p_pii_key),
    n.verification_tier,
    n.created_at,
    right(pgp_sym_decrypt(n.phone_enc, p_pii_key), 4),
    e.huuid,
    CASE WHEN e.huuid IS NULL THEN NULL ELSE pgp_sym_decrypt(e.full_name_enc, p_pii_key) END,
    e.verification_tier,
    e.created_at,
    CASE WHEN e.huuid IS NULL THEN NULL ELSE right(pgp_sym_decrypt(e.phone_enc, p_pii_key), 4) END,
    n.duplicate_pms_score
  FROM huuid_patients n
  LEFT JOIN huuid_patients e ON e.huuid = n.duplicate_of_huuid
  WHERE n.potential_duplicate = true AND n.duplicate_review_status = 'pending'
  ORDER BY n.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION huuid_clear_duplicate_flag(p_huuid text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_patients SET duplicate_review_status = 'cleared' WHERE huuid = p_huuid;
$$;

-- Keeps whichever of the two rows was created first, revokes the other
-- (status + DID document, matching the same two-table revocation pattern
-- huuid_gdpr_erase_patient uses -- but WITHOUT nulling any PII, since a
-- merge is not an erasure; the newer record's data is kept for audit,
-- just no longer resolvable). Which side is "older" is determined here
-- from created_at, never trusted from the caller, since mislabeling
-- which HUUID gets revoked is exactly the kind of mistake that shouldn't
-- be possible from a client-side bug.
CREATE OR REPLACE FUNCTION huuid_merge_duplicates(p_huuid_a text, p_huuid_b text)
RETURNS TABLE (older_huuid text, newer_huuid text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_older text;
  v_newer text;
BEGIN
  SELECT p.huuid INTO v_older FROM huuid_patients p WHERE p.huuid IN (p_huuid_a, p_huuid_b) ORDER BY p.created_at ASC LIMIT 1;
  SELECT p.huuid INTO v_newer FROM huuid_patients p WHERE p.huuid IN (p_huuid_a, p_huuid_b) AND p.huuid <> v_older LIMIT 1;

  IF v_older IS NULL OR v_newer IS NULL THEN
    RAISE EXCEPTION 'Both HUUIDs must exist to merge';
  END IF;

  -- Copy the newer record's medical profile onto the older one, but only
  -- if the older one doesn't already have one -- never overwrite an
  -- existing, possibly more current, medical profile.
  UPDATE huuid_patients older_row
  SET
    blood_type_enc = newer_row.blood_type_enc,
    allergies_enc = newer_row.allergies_enc,
    medications_enc = newer_row.medications_enc,
    chronic_conditions_enc = newer_row.chronic_conditions_enc,
    pregnancy_status_enc = newer_row.pregnancy_status_enc,
    organ_donor_enc = newer_row.organ_donor_enc,
    implanted_devices_enc = newer_row.implanted_devices_enc,
    primary_physician_name_enc = newer_row.primary_physician_name_enc,
    primary_physician_phone_enc = newer_row.primary_physician_phone_enc,
    primary_facility_name_enc = newer_row.primary_facility_name_enc,
    primary_facility_country_enc = newer_row.primary_facility_country_enc,
    contraindications_enc = newer_row.contraindications_enc,
    medical_profile_completed = true,
    updated_at = now()
  FROM huuid_patients newer_row
  WHERE older_row.huuid = v_older
    AND newer_row.huuid = v_newer
    AND older_row.medical_profile_completed = false
    AND newer_row.medical_profile_completed = true;

  UPDATE huuid_patients
  SET status = 'revoked', duplicate_of_huuid = v_older, duplicate_review_status = 'merged'
  WHERE huuid = v_newer;

  UPDATE huuid_did_documents SET status = 'revoked', updated_at = now() WHERE huuid = v_newer;

  UPDATE huuid_patients
  SET duplicate_review_status = 'merged'
  WHERE huuid = v_older AND potential_duplicate = true;

  RETURN QUERY SELECT v_older, v_newer;
END;
$$;

-- FRAUD SUSPECTED path: suspends the newer record immediately (status,
-- not revoked -- suspended is reversible pending investigation, revoked
-- is the merge/erasure endpoint) and marks the flag confirmed rather
-- than cleared or merged.
CREATE OR REPLACE FUNCTION huuid_flag_fraud_suspected(p_huuid text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_patients
  SET status = 'suspended', duplicate_review_status = 'confirmed_duplicate'
  WHERE huuid = p_huuid;
$$;

REVOKE ALL ON FUNCTION huuid_list_potential_duplicates(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_clear_duplicate_flag(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_merge_duplicates(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_flag_fraud_suspected(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_list_potential_duplicates(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_clear_duplicate_flag(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_merge_duplicates(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_flag_fraud_suspected(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_list_potential_duplicates(text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_clear_duplicate_flag(text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_merge_duplicates(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_flag_fraud_suspected(text) TO service_role;
