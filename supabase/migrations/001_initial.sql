-- ============================================================
-- HUUID Resolver — Migration 001: initial schema
-- Tables: huuid_did_documents, huuid_audit_log
-- huuid_audit_log is IMMUTABLE: no UPDATE, no DELETE, ever.
-- ============================================================

-- ── Table 1: DID documents (pointer map — never medical data) ──
CREATE TABLE huuid_did_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huuid         text UNIQUE NOT NULL,
  did_document  jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'revoked')),
  issuing_node  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_huuid_did_documents_huuid ON huuid_did_documents (huuid);
CREATE INDEX idx_huuid_did_documents_status ON huuid_did_documents (status);
CREATE INDEX idx_huuid_did_documents_created_at ON huuid_did_documents (created_at);

-- ── Table 2: audit log (immutable) ──
CREATE TABLE huuid_audit_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_entry_id       text UNIQUE NOT NULL,
  request_id           uuid NOT NULL,
  huuid                text NOT NULL,
  requesting_facility  text NOT NULL,
  purpose_code         text NOT NULL
                       CHECK (purpose_code IN ('Treatment', 'Administrative', 'Research', 'Emergency')),
  outcome              text NOT NULL
                       CHECK (outcome IN ('success', 'notFound', 'unauthorized', 'forbidden',
                                          'deactivated', 'rateLimitExceeded', 'internalError',
                                          'duplicateRequest')),
  break_glass          boolean NOT NULL DEFAULT false,
  resolved_at          timestamptz NOT NULL DEFAULT now(),
  response_time_ms     integer NOT NULL,
  ip_hash              text NOT NULL,
  resolver_version     text NOT NULL
);

CREATE INDEX idx_huuid_audit_log_resolved_at ON huuid_audit_log (resolved_at);
CREATE INDEX idx_huuid_audit_log_huuid ON huuid_audit_log (huuid);
CREATE INDEX idx_huuid_audit_log_request_id ON huuid_audit_log (request_id);
CREATE INDEX idx_huuid_audit_log_requesting_facility ON huuid_audit_log (requesting_facility);

-- ── RLS: enabled on both tables. Zero anon access. Zero authenticated access.
--    All resolver access is server-side via service_role. ──
ALTER TABLE huuid_did_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE huuid_audit_log ENABLE ROW LEVEL SECURITY;

-- No policies for anon or authenticated: RLS-enabled + no policy = denied.
-- service_role bypasses RLS; capabilities are constrained by GRANTs below.

-- ── GRANTs (MANDATORY post May 30 2026 — silent permission-denied without) ──
-- huuid_did_documents: service_role SELECT, INSERT, UPDATE. No DELETE (deactivate only).
GRANT SELECT, INSERT, UPDATE ON huuid_did_documents TO service_role;
-- huuid_audit_log: service_role SELECT + INSERT only. No UPDATE. No DELETE. Ever.
GRANT SELECT, INSERT ON huuid_audit_log TO service_role;

-- Explicitly revoke everything from anon and authenticated on both tables.
REVOKE ALL ON huuid_did_documents FROM anon, authenticated;
REVOKE ALL ON huuid_audit_log FROM anon, authenticated;

-- Belt-and-braces immutability: block UPDATE/DELETE on the audit log at the
-- database level, even for roles that bypass RLS.
CREATE OR REPLACE FUNCTION huuid_audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'huuid_audit_log is immutable: % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER trg_huuid_audit_log_no_update
  BEFORE UPDATE ON huuid_audit_log
  FOR EACH ROW EXECUTE FUNCTION huuid_audit_log_immutable();

CREATE TRIGGER trg_huuid_audit_log_no_delete
  BEFORE DELETE ON huuid_audit_log
  FOR EACH ROW EXECUTE FUNCTION huuid_audit_log_immutable();

-- ── Seed: one test DID document ──
INSERT INTO huuid_did_documents (huuid, did_document, issuing_node) VALUES (
  'did:huuid:gh:TEST7X29ALPHAxyz001',
  '{
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://huuid.health/contexts/v1"
    ],
    "id": "did:huuid:gh:TEST7X29ALPHAxyz001",
    "verificationMethod": [{
      "id": "did:huuid:gh:TEST7X29ALPHAxyz001#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:huuid:gh:TEST7X29ALPHAxyz001",
      "publicKeyMultibase": "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
    }],
    "authentication": ["did:huuid:gh:TEST7X29ALPHAxyz001#key-1"],
    "service": [{
      "id": "did:huuid:gh:TEST7X29ALPHAxyz001#record-test",
      "type": "HUUIDHealthRecord",
      "serviceEndpoint": "https://emr.test.gh/api/huuid/records",
      "facilityCode": "GH-TEST-001",
      "consentScope": ["summary", "allergies"]
    }],
    "huuid:status": "active"
  }',
  'did:huuid:gh:node-test-001'
)
ON CONFLICT (huuid) DO NOTHING;
