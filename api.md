# HUUID Resolver API

**Contract:** HUUID-RESOLVER-API-v0.1 + v0.2 (JWT layer) + Hours 61-80 (certificate status, duplicate detection, constant-time hardening) + Hours 81+ (DB round-trip reduction) · **W3C:** DID Resolution Spec 1.0 · **Version:** 1.0.0

The resolution engine behind `did:huuid` — a W3C-registered health identity method
built for Ghana's national healthcare identity infrastructure. The resolver returns
**pointer maps, not records**: medical data never touches this server.

---

## Governance and trust hierarchy

| Level | Entity | Role |
|---|---|---|
| **L0** | **HUUID Foundation** (international neutral root) | Holds root keys. Publishes resolver software. Registers national Root Authorities. Zero patient data access. Currently: HUUID Protocol Working Group acting as Foundation. |
| **L1** | **Root Authority** | Per-country trust anchor. Approves Research access, enrolls facilities, reviews Break-Glass events. |
| **L2** | **Issuing nodes / facilities** | Enroll patients, hold facility keys, make resolution requests. |

**Root Authority (current):** HUUID Protocol Working Group ·
Contact: josephtdnarnor@gmail.com

> Upon successful pilot adoption, operational control transitions to the
> national health authority of the adopting country.

### Consent tracks

All three consent tracks are **equal**. No track is the default. Which track
applies depends on the clinical situation:

- **Track A** — patient is conscious and present
- **Track B** — patient is incapacitated (Break-Glass)
- **Track C** — patient is a minor or has a legal guardian

### HTTP methods

| Method | Endpoint | Purpose |
|---|---|---|
| **GET** | `/1.0/identifiers/{did}` | Resolution — the only method for standard resolution |
| **POST** | `/1.0/identifiers/{did}/break-glass` | Break-Glass **only** (later build stage) |

All other references to the resolver mean **GET**. POST is never used for
standard resolution.

---

## The Audit-First Rule (non-negotiable)

Every resolution attempt — success or failure — writes **one immutable audit record
before the HTTP response is sent**. The audit write is synchronous and blocking.
If it fails, the resolution fails with `500 internalError` and no DID document is
returned. A resolution that is not audited is a resolution that never happened.

The audit log (`huuid_audit_log`) permits INSERT and SELECT for `service_role` only.
There is no UPDATE policy. There is no DELETE policy. Database triggers reject both
operations even for roles that bypass RLS.

**Audit log access:** Root Authority via service role only. Facilities see only
their own records. Patients can request their own access history.
Endpoint: `GET /1.0/audit/{huuid}` — requires scoped JWT *(later build stage)*.
The audit log never contains medical data.

---

## Endpoint

### `GET /1.0/identifiers/{did}`

W3C DID Resolution endpoint. **GET only** — POST is not supported on this route
(a POST resolver breaks Universal Resolver driver compatibility). The only POST
in the protocol is `POST /1.0/identifiers/{did}/break-glass`, for Break-Glass
access exclusively *(later build stage)*.

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
| `X-HUUID-Facility` | Yes | DID of the requesting facility, e.g. `did:huuid:gh:node-korlebu-reg`. Must equal the JWT `sub` claim exactly, or `401`. |
| `X-HUUID-Request-ID` | Yes | UUID v4, generated fresh per request. Must equal the JWT `jti` claim exactly, or `401`. Must never be reused, or `409` — see **Duplicate request detection** below. Recorded in the audit log. |
| `Accept` | Recommended | `application/did+ld+json` (server default). |
| `Authorization` | Yes | `Bearer {JWT}` — Ed25519 (EdDSA), signed by the facility's private key, verified against the facility's registered public key in `huuid_facilities`. See **JWT verification** below. |

### JWT verification (HUUID-RESOLVER-API-v0.2)

Every request's `Authorization: Bearer {JWT}` is verified before resolution
proceeds. All of the following must hold, or the request returns `401
unauthorized`:

1. **Signature** — Ed25519 (`alg: EdDSA`), verified against the requesting
   facility's `public_key_multibase` in `huuid_facilities`. The facility DID
   must be registered and resolvable; an unknown facility is `401`.
2. **`aud`** — must equal exactly `https://resolver.huuid.health`.
3. **Replay window** — `exp - iat` must be `<= 300` seconds.
4. **`jti` == `X-HUUID-Request-ID`** — the token's `jti` claim must match the
   request header exactly.
5. **`sub` == `X-HUUID-Facility`** — the token's `sub` claim must match the
   request header exactly.

Full JWT `iss`/`kid` chain validation beyond `sub`/`aud`/`exp`/`iat`/`jti` is
deferred to a later build stage — see **Deferred to later build stages**
below.

### Certificate status enforcement (Hours 61-80)

After JWT verification, the requesting facility's `certificate_status` is
checked. It comes from the **same query** used to fetch `public_key_multibase`
for JWT verification (`SELECT public_key_multibase, certificate_status FROM
huuid_facilities WHERE facility_did = $1`) — one round trip covers both
concerns, not two.

| `certificate_status` | Result |
|---|---|
| `active` | Resolution proceeds. |
| `suspended` | `403 forbidden` — *"Facility certificate is suspended. Contact HUUID Protocol Working Group: josephtdnarnor@gmail.com"* |
| `revoked` | `403 forbidden` — *"Facility certificate has been revoked."* |

Both outcomes write an audit record with `outcome: forbidden` before the
response is sent.

### Duplicate request detection (Hours 61-80, round-trip reduced Hours 81+)

`X-HUUID-Request-ID` must not be reused (`huuid_request_log`, `request_id
UNIQUE`). Enforced in a single round trip:

```sql
INSERT INTO huuid_request_log (request_id, facility_did)
VALUES ($1, $2)
ON CONFLICT (request_id) DO NOTHING
RETURNING id
```

No row returned means the conflict fired — the ID was already logged — and
the request is rejected with `409 duplicateRequest` **before
`huuid_audit_log` is touched at all**; no audit row is written for a
rejected duplicate. This is the one exception to the audit-first rule, by
design: a rejected replay never reached resolution. (An earlier
implementation used a time-scoped `SELECT` followed by a separate `INSERT`
— two round trips. Since `request_id` is uniquely constrained forever, not
just for 24h, and no purge job exists yet, the upsert is both simpler and
strictly more correct.)

### Constant-time resolution outcomes (Hours 61-80)

Every DID-resolution outcome — `200` success, `404` notFound, `410`
deactivated — is padded to a minimum of 150ms of total elapsed time before
the response is sent, applied uniformly regardless of outcome. This prevents
timing-based enumeration of whether a HUUID exists, never existed, or was
revoked. Earlier failure paths (400/401/403/409/500) are not padded — the
timing concern is specifically about distinguishing DID-existence states.

**Known limitation, measured in production — still open (Hours 61-80 and
Hours 81+):** the 150ms floor does not reliably converge 404-vs-410 timing.

- **Hours 61-80 baseline** (up to 5 DB round trips per resolution): 10
  rounds, median delta ~206ms, max ~455ms.
- **Hours 81+** (facility+certificate lookup confirmed as one query;
  duplicate detection reduced from select-then-insert to a single
  `ON CONFLICT DO NOTHING RETURNING id` upsert — 4 round trips minimum:
  facility+certificate lookup, request-log upsert, DID lookup, the
  non-negotiable audit write): re-measured across **4 independent batches
  of 15 rounds each (60 requests total)** run back-to-back. Per-batch
  medians: **27ms, 182ms, 105ms, 112ms** — only 1 of 4 batches met the
  target. This is real, reproducible variance, not a one-off fluke.

**Target (median delta under 50ms) was not reliably met.** Reducing the
round-trip count from 5 to 4 measurably helped (batch medians are mostly
lower than the 206ms baseline) but did not solve the underlying problem:
cross-region network jitter between Vercel (`iad1`) and Supabase
(`eu-west-1`) on each remaining round trip is itself larger and more
variable than the 50ms budget, so shaving one round trip off four does not
reliably close the gap. Further code-level round-trip reduction has
diminishing returns from here. The remaining options are: raise the floor
substantially (e.g. to 1-2s, comfortably above observed worst-case
round-trip variance — adds real latency to every request), or co-locate the
Vercel deployment and Supabase project in the same region (removes the
jitter source entirely). Both are operator decisions, not further "fix the
code" work.

### Example request

```bash
curl -i "https://huuid-resolver.vercel.app/1.0/identifiers/did:huuid:gh:TEST7X29ALPHAxyz001" \
  -H "Authorization: Bearer {facility-signed Ed25519 JWT}" \
  -H "X-HUUID-Purpose: Treatment" \
  -H "X-HUUID-Facility: did:huuid:gh:node-test-001" \
  -H "X-HUUID-Request-ID: f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

The JWT's `jti` claim must equal the `X-HUUID-Request-ID` value above, and
its `sub` claim must equal the `X-HUUID-Facility` value above. See
`/debug/resolver` for a live JWT-signing/verification harness against the
seeded test facility.

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
| 401 | `unauthorized` | JWT missing/expired/invalid signature, `aud` mismatch, `exp - iat > 300s`, `jti` != `X-HUUID-Request-ID`, `sub` != `X-HUUID-Facility`, or unknown facility | Generate a fresh JWT with matching claims. |
| 403 | `forbidden` | `Research` purpose — blocked until Root Authority approval; facility certificate `suspended` or `revoked` | Contact the Root Authority (HUUID Protocol Working Group — see Governance). |
| 404 | `notFound` | HUUID does not exist. Identical response time to `410` (150ms floor) — no enumeration signal. | Do not retry. |
| 409 | `duplicateRequest` | `X-HUUID-Request-ID` reused (enforced indefinitely — see **Duplicate request detection**). No audit row is written for this outcome. | Generate a new UUID. |
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

Temporary raw-data debug page (Build Rule 4). Shows live JWT verification
results for four test cases (valid, expired, oversized window, `jti`
mismatch), a live certificate-suspension test (suspends the test facility,
confirms `403`, restores to `active`), a live duplicate-request test
(same `X-HUUID-Request-ID` twice, confirms `409` on the second), a
deterministic response-time-floor confirmation, the `huuid_facilities`
table, all DID documents, the last 10 audit rows, and a copy-paste curl
test. **Remove before public launch.**

---

## Facility schema (`huuid_facilities`)

Facility registry used to verify Ed25519 JWT signatures. No anon or
authenticated access — server-side (`service_role`) only.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `facility_did` | text | Unique. The facility's DID — must equal both `X-HUUID-Facility` and the JWT `sub` claim. |
| `facility_name` | text | Human-readable name |
| `certificate_status` | text | `active` \| `suspended` \| `revoked`. Enforced after JWT verification — `suspended`/`revoked` return `403 forbidden`, audited. |
| `public_key_multibase` | text | Multibase (`z...`, base58btc, Ed25519 multicodec `0xed01` prefix) — the facility's public key, used to verify JWT signatures. |
| `created_at` | timestamptz | |

---

## Request log schema (`huuid_request_log`)

Replay-detection log for `X-HUUID-Request-ID` (Hours 61-80). No anon or
authenticated access — server-side (`service_role`) only. Append-only.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `request_id` | uuid | Unique. Enforced indefinitely via `ON CONFLICT DO NOTHING` (no time window, no purge job yet — see Deferred). |
| `facility_did` | text | The requesting facility. |
| `logged_at` | timestamptz | |

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
| `HUUID_TEST_FACILITY_JWK` | **Server only** | Ed25519 private key (JWK JSON) for the seeded test facility. Used exclusively by `/debug/resolver` to sign demonstration JWTs. Never committed. |

---

## Deferred to later build stages

- Rolling rate limits + `Retry-After` (Treatment/Administrative)
- Break-Glass threshold automation (Emergency > 10/24h → certificate suspension)
- Full JWT `iss`/`kid` chain validation beyond `sub`/`aud`/`exp`/`iat`/`jti`
- `huuid_request_log` retention/purge job (rows currently accumulate indefinitely)
