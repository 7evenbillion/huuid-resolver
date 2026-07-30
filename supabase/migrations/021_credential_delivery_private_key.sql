-- ============================================================
-- HUUID Resolver — Migration 021: private key custody for credential
-- delivery (Layer 4 dependency, found necessary while building Layer 3)
--
-- Migration 020's huuid_facility_credential_deliveries schema (as
-- specified) had no column to actually hold the facility private key
-- between the moment Layer 3 generates it and the moment Layer 4's
-- single-use download page serves it — without this, "download your
-- credential package" would have nothing real to download. Encrypted at
-- rest with the same pgp_sym_encrypt convention already used for patient
-- PII (migration 013) and the medical profile (migration 018), keyed by
-- the same HUUID_PII_ENCRYPTION_KEY. Cleared to NULL the moment it is
-- downloaded (server sets it NULL right after serving the package), so
-- the plaintext key material has the shortest possible server-side
-- lifetime after the one legitimate read.
-- ============================================================

ALTER TABLE huuid_facility_credential_deliveries
  ADD COLUMN private_key_pem_enc bytea;

GRANT SELECT, INSERT, UPDATE ON huuid_facility_credential_deliveries TO service_role;
