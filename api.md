# HUUID Resolver API

**Contract:** HUUID-RESOLVER-API-v0.1 · **W3C:** DID Resolution Spec 1.0 · **Version:** 1.0.0

The resolution engine behind `did:huuid` — a W3C-registered health identity method
built for Ghana's national healthcare identity infrastructure. The resolver returns
**pointer maps, not records**: medical data never touches this server.

---

## The Audit-First Rule (non-negotiable)

Every resolution attempt — success or failure — writes **one immutable audit record
before the HTTP response is sent**. The audit write is synchronous and blocking.
If it fails, the resolution fails with `500 internalError` and no DID document is
returned. A resolution that is not audited is a resolution that never happened.

The audit log (`huuid_audit_log`) permits INSERT and SELECT for `service_role` only.
There is no UPDATE policy. There is no DELETE policy. Database triggers reject both
operations even for roles that bypass RLS.

---

## Endpoint

### `GET /1.0/identifiers/{did}`

W3C DID Resolution endpoint. **GET only** — POST is not supported (a POST resolver
breaks Universal Resolver driver compatibility).

```
GET /1.0/identifiers/did:huuid:gh:TEST7X29ALPHAxyz001
```

- Response `Content-Type`: `application/did+ld+json`
- `Cache-Control: no-store` on **every** response, including errors
- `X-HUUID-Audit-ID` header on **every** response
- HTTPS only

### Request headers — all required

| Header | Required | Description |
|---|---|---|
| `X-HUUID-Purpose` | Yes | Enum: `Treatment` \| `Administrative` \| `Research` \| `Emergency`. Missing or invalid → `400`. |
| `X-HUUID-Facility` | Yes | DID of the requesting facility, e.g. `did:huuid:gh:node-korlebu-reg`. |
| `X-HUUID-Request-ID` | Yes | UUID v4, generated fresh per request. Recorded in the audit log. |
| `Accept` | Recommended | `application/did+ld+json` (server default). |
| `Authorization` | Deferred | `Bearer {JWT}` (Ed25519, facility-signed). **Not verified in this build stage** — scheduled for Hours 41–60. |

### Example request

```bash
curl -i "https://huuid-resolver.vercel.app/1.0/identifiers/did:huuid:gh:TEST7X29ALPHAxyz001" \
  -H "X-HUUID-Purpose: Treatment" \
  -H "X-HUUID-Facility: did:huuid:gh:node-korlebu-reg" \
  -H "X-HUUID-Request-ID: f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

### Success response — `200 OK`

W3C DID Resolution Result: three top-level fields.

```json
{
  "@context": "https://w3id.org/did-resolution/v1",
  "didDocument": {
    "@context": ["https://www.w3.org/ns/did/v1", "https://huuid.health/contexts/v1"],
    "id": "did:huuid:gh:TEST7X29ALPHAxyz001",
    "verificationMethod": [{
      "id": "did:huuid:gh:TEST7X29ALPHAxyz001#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:huuid:gh:TEST7X29ALPHAxyz001",
      "publicKeyMultibase": "z6Mkha..."
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
  },
  "didResolutionMetadata": {
    "contentType": "application/did+ld+json",
    "resolvedAt": "2026-07-15T09:14:22Z",
    "resolverVersion": "huuid-resolver/1.0.0",
    "durationMs": 87
  },
  "didDocumentMetadata": {
    "created": "2026-07-15T08:23:11Z",
    "updated": "2026-07-15T08:23:11Z",
    "deactivated": false,
    "versionId": "1",
    "huuid:issuingNode": "did:huuid:gh:node-test-001",
    "huuid:purposeCode": "Treatment",
    "huuid:requestingFacility": "did:huuid:gh:node-korlebu-reg",
    "huuid:requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "huuid:auditEntryId": "audit-20260715-091422-f47ac10b"
  }
}
```

### Error responses

All errors follow the W3C DID Resolution error format — `didDocument` is `null`,
`didResolutionMetadata.error` is a machine-readable enum, `errorMessage` is
human-readable.

```json
{
  "@context": "https://w3id.org/did-resolution/v1",
  "didDocument": null,
  "didResolutionMetadata": {
    "error": "notFound",
    "errorMessage": "HUUID not found in registry.",
    "resolvedAt": "2026-07-15T09:14:22Z",
    "huuid:requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  },
  "didDocumentMetadata": {}
}
```

| HTTP | `error` enum | Trigger | Client action |
|---|---|---|---|
| 400 | `invalidRequest` | Missing/invalid header, bad purpose enum, malformed DID, non-UUID request ID | Fix the request before retrying. |
| 401 | `unauthorized` | *(Hours 41–60)* JWT missing/expired/invalid, `exp - iat > 300s` | Generate a fresh JWT. |
| 403 | `forbidden` | `Research` purpose — blocked until Root Authority approval; suspended facility certificate *(later stage)* | Contact Root Authority. |
| 404 | `notFound` | HUUID does not exist. Identical response for never-existed and deleted — no enumeration signal. | Do not retry. |
| 409 | `duplicateRequest` | *(later stage)* Request-ID reused within 24h | Generate a new UUID. |
| 410 | `deactivated` | HUUID exists but is revoked or suspended | Patient must re-enroll at the issuing node. |
| 429 | `rateLimitExceeded` | *(later stage)* >50 unique resolutions/hour for Treatment/Administrative | Respect `Retry-After`. |
| 500 | `internalError` | **Audit write failed — resolution aborted.** Also raised on DB lookup failure. | Retry later; the resolver refuses to resolve unaudited. |

### Rate limits

| Purpose | Limit | Current build behaviour |
|---|---|---|
| Treatment | 50 unique/hour (rolling) | Not yet enforced (later stage) |
| Administrative | 50 unique/hour (rolling) | Not yet enforced (later stage) |
| Research | 0 — blocked | **`403 forbidden` immediately** ✅ |
| Emergency | Unlimited (Break-Glass rules apply) | Audited with `break_glass: true` ✅ |

Rate limits are per facility DID, not per IP. More than 10 Emergency resolutions
from one facility in 24 hours triggers Root Authority review (Break-Glass spec).

---

## Supporting endpoints

### `GET /api/health`

Unauthenticated health probe. `200` when healthy, `503` when the database is down.

```json
{ "status": "ok", "timestamp": "…", "version": "1.0.0", "database": "connected", "services": { "supabase": "ok" } }
```

### `GET /debug/resolver`

Temporary raw-data debug page (Build Rule 4). Shows all DID documents, the last 10
audit rows, and a copy-paste curl test. **Remove before public launch.**

---

## Audit record schema (`huuid_audit_log`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `audit_entry_id` | text | Unique. Format: `audit-YYYYMMDD-HHmmss-{requestId[0:8]}` |
| `request_id` | uuid | From `X-HUUID-Request-ID` (server-generated if the header was missing/invalid, so the attempt is still audited) |
| `huuid` | text | The DID string requested (`invalid` when malformed) |
| `requesting_facility` | text | From `X-HUUID-Facility` (`missing` when absent) |
| `purpose_code` | text | `Treatment` \| `Administrative` \| `Research` \| `Emergency` |
| `outcome` | text | `success` \| `notFound` \| `unauthorized` \| `forbidden` \| `deactivated` \| `rateLimitExceeded` \| `internalError` \| `duplicateRequest` |
| `break_glass` | boolean | `true` for Emergency purpose |
| `resolved_at` | timestamptz | Server time of the audit write |
| `response_time_ms` | integer | Elapsed at audit time |
| `ip_hash` | text | **SHA-256 of requester IP — raw IPs are never stored** |
| `resolver_version` | text | e.g. `1.0.0` |

Header-validation failures (400) are audited with outcome `unauthorized` — the
outcome enum has no `invalidRequest` value, and an unaudited failed attempt is
not acceptable.

---

## Environment variables

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anon key (no table access — everything is service-role) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Resolver DB access. Never in client code, never logged. |
| `HUUID_RESOLVER_VERSION` | Server | Version stamped into responses and audit rows |

---

## Deferred to later build stages

- Facility JWT verification (EdDSA / Ed25519, `exp - iat ≤ 300s`, `jti` = Request-ID) — Hours 41–60
- `409 duplicateRequest` (Request-ID replay window)
- Rolling rate limits + `Retry-After` (Treatment/Administrative)
- Constant-time 404 indistinguishability hardening
- Break-Glass threshold automation (Emergency > 10/24h → certificate suspension)
