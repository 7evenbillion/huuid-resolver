-- ============================================================
-- HUUID Resolver — Migration 020: Facility onboarding
--
-- Four tables for the facility onboarding + dashboard build (Layers 1-9):
--   huuid_facility_applications      — facility applies to join, pending approval
--   huuid_facility_credential_deliveries — secure, single-use credential download
--   huuid_consent_requests           — patient consent (SMS/QR/card PIN/verbal)
--   huuid_identity_map_registry      — facility <-> HUUID local-ID linking
--
-- huuid_facilities itself already exists (migration 002) and is not
-- recreated here — Layer 3 (Root Authority approval) INSERTs into it the
-- same way the seeded test facility was inserted, once an application is
-- approved and a facility DID + Ed25519 keypair are generated.
-- ============================================================

-- ------------------------------------------------------------
-- huuid_facility_applications
-- ------------------------------------------------------------

CREATE TABLE huuid_facility_applications (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id                    text UNIQUE NOT NULL, -- APP-[YYYY]-[6 random digits]

  facility_name                     text NOT NULL,
  facility_type                     text NOT NULL
                                     CHECK (facility_type IN (
                                       'teaching_hospital', 'regional_hospital',
                                       'district_hospital', 'clinic', 'laboratory',
                                       'pharmacy', 'imaging_center',
                                       'specialist_center', 'other'
                                     )),
  country_code                      text NOT NULL,
  region                             text NOT NULL,
  physical_address                  text NOT NULL,
  government_registration_number    text NOT NULL,

  authorised_signatory_name         text NOT NULL,
  authorised_signatory_role         text NOT NULL,
  authorised_signatory_phone        text NOT NULL,
  authorised_signatory_email        text,

  it_contact_name                   text NOT NULL,
  it_contact_phone                  text NOT NULL,

  emr_system                        text NOT NULL
                                     CHECK (emr_system IN (
                                       'epic', 'cerner', 'openemrs', 'bahmni',
                                       'meditech', 'custom', 'paper', 'other'
                                     )),
  estimated_daily_patients          integer NOT NULL,

  declaration_accepted              boolean NOT NULL DEFAULT false,
  declaration_timestamp             timestamptz,
  declaration_ip_hash               text,

  status                             text NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  rejection_reason                  text,
  approved_at                       timestamptz,
  approved_by                       text DEFAULT 'root-authority',
  facility_did                      text UNIQUE,

  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_huuid_facility_applications_status
  ON huuid_facility_applications (status);
CREATE INDEX idx_huuid_facility_applications_gov_reg_number
  ON huuid_facility_applications (government_registration_number);

ALTER TABLE huuid_facility_applications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON huuid_facility_applications TO service_role;
REVOKE ALL ON huuid_facility_applications FROM anon, authenticated;

-- ------------------------------------------------------------
-- huuid_facility_credential_deliveries
-- ------------------------------------------------------------

CREATE TABLE huuid_facility_credential_deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_did       text NOT NULL,
  download_token     text UNIQUE NOT NULL, -- crypto.randomBytes(32).toString('base64url')
  download_url       text NOT NULL,
  expires_at         timestamptz NOT NULL, -- 24 hours from creation
  downloaded         boolean NOT NULL DEFAULT false,
  downloaded_at      timestamptz,
  download_ip_hash   text,
  otp_hash           text NOT NULL, -- SHA-256 of the 6-digit OTP sent via SMS
  otp_verified       boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_huuid_facility_credential_deliveries_facility_did
  ON huuid_facility_credential_deliveries (facility_did);
CREATE INDEX idx_huuid_facility_credential_deliveries_expires_at
  ON huuid_facility_credential_deliveries (expires_at);

ALTER TABLE huuid_facility_credential_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON huuid_facility_credential_deliveries TO service_role;
REVOKE ALL ON huuid_facility_credential_deliveries FROM anon, authenticated;

-- ------------------------------------------------------------
-- huuid_consent_requests
--
-- Immutable once status transitions to 'granted' or 'declined' (build
-- brief's explicit requirement) — the audit trail of a patient's consent
-- decision must be permanent. Rows may still be updated/deleted while
-- 'pending' or 'expired' (e.g. by a future cleanup job); the trigger only
-- locks a row the moment a real consent decision has been recorded.
-- ------------------------------------------------------------

CREATE TABLE huuid_consent_requests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id                  text UNIQUE NOT NULL, -- CONSENT-[timestamp]-[8 random chars]

  huuid                       text NOT NULL,
  requesting_facility_did     text NOT NULL,
  requesting_facility_name    text NOT NULL,
  record_types_requested      text[] NOT NULL,
  holding_facility_names      text[] NOT NULL,

  consent_method              text NOT NULL
                               CHECK (consent_method IN ('sms', 'qr', 'card_pin', 'verbal')),
  status                       text NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'granted', 'declined', 'expired')),

  patient_phone_hash          text NOT NULL,
  sms_sent_at                 timestamptz,
  response_received_at        timestamptz,
  expires_at                  timestamptz NOT NULL, -- 5 minutes from creation

  verbal_recorded_by          text,
  flagged_for_review          boolean NOT NULL DEFAULT false,

  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_huuid_consent_requests_huuid_status
  ON huuid_consent_requests (huuid, status);
CREATE INDEX idx_huuid_consent_requests_expires_at
  ON huuid_consent_requests (expires_at);
CREATE INDEX idx_huuid_consent_requests_requesting_facility_did
  ON huuid_consent_requests (requesting_facility_did);

ALTER TABLE huuid_consent_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON huuid_consent_requests TO service_role;
REVOKE ALL ON huuid_consent_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION huuid_consent_requests_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('granted', 'declined') THEN
    RAISE EXCEPTION
      'huuid_consent_requests row % is immutable once granted/declined: % is not permitted',
      OLD.consent_id, TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_huuid_consent_requests_immutable_update
  BEFORE UPDATE ON huuid_consent_requests
  FOR EACH ROW EXECUTE FUNCTION huuid_consent_requests_immutable();

CREATE TRIGGER trg_huuid_consent_requests_immutable_delete
  BEFORE DELETE ON huuid_consent_requests
  FOR EACH ROW EXECUTE FUNCTION huuid_consent_requests_immutable();

-- ------------------------------------------------------------
-- huuid_identity_map_registry
--
-- Tracks which facilities have linked which patients. No local patient
-- IDs stored here — those stay in each facility's own EMR/Stub database.
-- ------------------------------------------------------------

CREATE TABLE huuid_identity_map_registry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huuid         text NOT NULL,
  facility_did  text NOT NULL,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  linked_by     text NOT NULL,
  link_method   text NOT NULL
                CHECK (link_method IN (
                  'patient_presented_card', 'retrospective_link', 'facility_enrollment'
                )),
  UNIQUE (huuid, facility_did)
);

CREATE INDEX idx_huuid_identity_map_registry_huuid
  ON huuid_identity_map_registry (huuid);
CREATE INDEX idx_huuid_identity_map_registry_facility_did
  ON huuid_identity_map_registry (facility_did);

ALTER TABLE huuid_identity_map_registry ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON huuid_identity_map_registry TO service_role;
REVOKE ALL ON huuid_identity_map_registry FROM anon, authenticated;
