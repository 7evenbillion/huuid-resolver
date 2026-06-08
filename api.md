# HUUID Resolver API — v0.1

**W3C DID Method:** `did:huuid`  
**Base URL:** `https://resolver.huuid.health`  
**Spec:** HUUID-RESOLVER-API-v0.1  
**Status:** Month 2 Build Sprint

---

## Canonical Endpoint
GET /1.0/identifiers/{did}
### Required Request Headers

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes | `Bearer {JWT}` signed with facility Ed25519 key |
| `X-HUUID-Purpose` | Yes | `Treatment` / `Administrative` / `Research` / `Emergency` |
| `X-HUUID-Facility` | Yes | DID of requesting facility |
| `X-HUUID-Request-ID` | Yes | UUID v4, fresh per request |

---

## Success Response (200)

```json
{
  "@context": "https://w3id.org/did-resolution/v1",
  "didDocument": {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://huuid.health/contexts/v1"
    ],
    "id": "did:huuid:gh:7X29ALPHAxyz4Kf9mR2vNbQs",
    "verificationMethod": [{
      "id": "did:huuid:gh:7X29ALPHAxyz4Kf9mR2vNbQs#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:huuid:gh:7X29ALPHAxyz4Kf9mR2vNbQs",
      "publicKeyMultibase": "z6MkhaXgBZDvotDkL..."
    }],
    "service": [{
      "id": "did:huuid:gh:7X29ALPHAxyz4Kf9mR2vNbQs#record-korlebu",
      "type": "HUUIDHealthRecord",
      "serviceEndpoint": "https://emr.kbu.gh/api/huuid/records",
      "facilityCode": "GH-KBU-001",
      "consentScope": ["summary", "allergies", "medications"]
    }],
    "huuid:status": "active"
  },
  "didResolutionMetadata": {
    "contentType": "application/did+ld+json",
    "resolvedAt": "2026-06-08T09:14:22Z",
    "resolverVersion": "huuid-resolver/1.0.0"
  },
  "didDocumentMetadata": {
    "created": "2026-01-15T08:23:11Z",
    "deactivated": false,
    "huuid:purposeCode": "Treatment",
    "huuid:requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "huuid:auditEntryId": "audit-20260608-091422-f47ac10b"
  }
}
```

---

## Error Codes

| Code | Error | Trigger |
|---|---|---|
| 400 | `invalidRequest` | Missing headers or bad purposeCode |
| 401 | `unauthorized` | JWT expired or invalid |
| 403 | `forbidden` | Facility certificate suspended |
| 404 | `notFound` | HUUID not in registry |
| 410 | `deactivated` | HUUID revoked |
| 429 | `rateLimitExceeded` | Over 50 resolutions/hour |
| 500 | `internalError` | Audit write failed |

---

## Audit Rule

**Audit writes BEFORE response. If audit fails, resolution fails.**  
Every request writes one record to `huuid_audit_log` before HTTP response is sent.

---

## Rate Limits

| Purpose | Limit | Window |
|---|---|---|
| Treatment / Administrative | 50 unique/hour | Rolling |
| Emergency | Unlimited | — |
| Research | Blocked | Root Authority approval required |

---

## Stack

- **Runtime:** Next.js 14 on Vercel
- **Database:** Supabase (prefix: `huuid_`)
- **Auth:** Ed25519 JWT
- **Table prefixes:** `huuid_did_documents`, `huuid_audit_log`, `huuid_facilities`
