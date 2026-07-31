-- ============================================================
-- HUUID Resolver — Migration 028: local_patient_id on identity map (Layer 8)
--
-- Real conflict found building Layer 8: its own spec requires "Look up
-- HUUID from huuid_identity_map_registry using facilityDID +
-- localPatientId" -- but migration 020's schema for this table
-- (written from Layer 1's literal spec, and its own comment) deliberately
-- excluded local patient IDs: "No local patient IDs stored here -- those
-- stay in each facility's own EMR/Stub database." Layer 8 cannot
-- function as specified without SOME (facility_did, local_patient_id) ->
-- huuid mapping living somewhere queryable by the resolver -- adding it
-- here rather than reinterpreting Layer 8 around a materially different
-- (and unrequested) design. Nullable: the "patient_presented_card" /
-- "retrospective_link" methods from Layer 6/7's Verify Patient flow
-- still have no natural local ID at the moment of linking unless staff
-- explicitly enter one.
-- ============================================================

ALTER TABLE huuid_identity_map_registry
  ADD COLUMN IF NOT EXISTS local_patient_id text;

CREATE INDEX IF NOT EXISTS idx_huuid_identity_map_registry_facility_local_id
  ON huuid_identity_map_registry (facility_did, local_patient_id);

GRANT SELECT, INSERT, UPDATE ON huuid_identity_map_registry TO service_role;
