-- ============================================================
-- HUUID Resolver — Migration 004: seed a revoked test DID document
-- No schema change. Needed so 404 (not found) vs 410 (revoked) response
-- timing can be genuinely compared in production (Hours 61-80, Task 3).
-- ============================================================

INSERT INTO huuid_did_documents (huuid, did_document, status, issuing_node) VALUES (
  'did:huuid:gh:TEST7X29ALPHAxyz002',
  '{
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://huuid.health/contexts/v1"
    ],
    "id": "did:huuid:gh:TEST7X29ALPHAxyz002",
    "verificationMethod": [{
      "id": "did:huuid:gh:TEST7X29ALPHAxyz002#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:huuid:gh:TEST7X29ALPHAxyz002",
      "publicKeyMultibase": "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
    }],
    "authentication": ["did:huuid:gh:TEST7X29ALPHAxyz002#key-1"],
    "service": [{
      "id": "did:huuid:gh:TEST7X29ALPHAxyz002#record-test",
      "type": "HUUIDHealthRecord",
      "serviceEndpoint": "https://emr.test.gh/api/huuid/records",
      "facilityCode": "GH-TEST-001",
      "consentScope": ["summary", "allergies"]
    }],
    "huuid:status": "revoked"
  }',
  'revoked',
  'did:huuid:gh:node-test-001'
)
ON CONFLICT (huuid) DO NOTHING;
