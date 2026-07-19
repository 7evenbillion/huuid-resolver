# HUUID Resolver API

**Contract:** HUUID-RESOLVER-API-v0.1 + v0.2 (JWT layer) + Hours 61-80 (certificate status, duplicate detection, constant-time hardening) + Hours 81+ (DB round-trip reduction, region co-location) + Month 3 (HUUID-BREAK-GLASS-API-v0.2) + Month 4 (HUUID-EMR-STUB-v0.1.2 §P4, Stub Integrity Alert receiver) · **W3C:** DID Resolution Spec 1.0 · **Version:** 1.0.0

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
| **POST** | `/1.0/identifiers/{did}/break-glass` | Break-Glass **only** — the only POST endpoint in HUUID (shipped Month 3) |

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

**Timing convergence history — resolved (Hours 81+, region co-location).**
Three stages, each measured in production, not localhost:

1. **Hours 61-80 baseline** (up to 5 DB round trips per resolution, Vercel
   `iad1` / Supabase `eu-west-1`): 10 rounds, median delta ~206ms, max ~455ms.
2. **Round-trip reduction** (facility+certificate lookup confirmed as one
   query; duplicate detection reduced from select-then-insert to a single
   `ON CONFLICT DO NOTHING RETURNING id` upsert — 4 round trips minimum:
   facility+certificate lookup, request-log upsert, DID lookup, the
   non-negotiable audit write; still `iad1`/`eu-west-1`): 4 independent
   batches of 15 rounds each (60 requests total), back-to-back. Per-batch
   medians: **27ms, 182ms, 105ms, 112ms** — only 1 of 4 batches met the
   50ms target. Real, reproducible variance, not a one-off fluke: cross-region
   network jitter on each remaining round trip was itself larger and more
   variable than the 50ms budget, so shaving one round trip off four did not
   reliably close the gap.
3. **Region co-location** (`vercel.json` pins the deployment to `cdg1`,
   Paris — the closest Vercel region to Supabase `eu-west-1`): same 4-batch/
   60-request methodology. Per-batch medians: **59ms, 46ms, 19ms, 51ms**,
   overall aggregate median **43ms** — under the 50ms target, and a much
   tighter, more consistent spread than the erratic 27-182ms range from
   round-trip reduction alone. Max per-batch deltas can still spike (observed
   up to ~463ms), likely cold-start-adjacent lambda instances rather than
   steady-state jitter, so this is not a hard per-request guarantee — but the
   typical-case timing side-channel, which is what actually matters for
   enumeration resistance, is now meaningfully closed.

**Takeaway:** for this deployment, cross-region network jitter — not DB
round-trip count — was the dominant source of 404-vs-410 timing variance.
Reducing round trips helped but was insufficient alone; co-locating the
Vercel deployment region with the Supabase region is what actually closed
the gap. If per-request outlier spikes still matter for the threat model,
raising the 150ms floor further remains an option, but is no longer
necessary to hit the stated target.

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

## Break-Glass endpoint (Month 3 — HUUID-BREAK-GLASS-API-v0.2)

### `POST /1.0/identifiers/{did}/break-glass`

Track B of the three equal HUUID consent tracks — Track A
(Physical-Present-Consent), Track B (Break-Glass, patient incapacitated),
Track C (Guardian Proxy). None is superior. The **only POST endpoint** in
HUUID: it carries a clinician-signed body that cannot travel in a GET.

Every invocation is a clinician asserting, under professional license, that
a patient is incapacitated and emergency access is necessary. That
assertion is permanently recorded and cannot be edited or deleted
(`huuid_bg_audit_log` is immutable, same enforcement pattern as the
standard `huuid_audit_log`).

### Request headers

| Header | Required | Description |
|---|---|---|
| `Content-Type` | Yes | `application/json` |
| `Authorization` | Yes | `Bearer {ProviderJWT}` — signed by the **individual clinician's** key, not the facility's. See ProviderJWT below. |
| `X-HUUID-Facility` | Yes | Requesting facility DID. |
| `X-HUUID-Request-ID` | Yes | UUID v4. Must equal the ProviderJWT `jti`. |
| `X-HUUID-BG-Reason` | Yes | Enum: `cardiac_arrest` \| `respiratory_failure` \| `trauma` \| `unconscious` \| `anaphylaxis` \| `stroke` \| `other`. |

### Request body

```json
{
  "providerCertificate": {
    "providerId": "did:huuid:gh:clinician-dr-ama-owusu-001",
    "providerName": "Dr. Ama Owusu",
    "licenseNumber": "GH-MED-2019-4471",
    "issuingAuthority": "Ghana Medical and Dental Council",
    "facilityId": "did:huuid:gh:node-korlebu-reg",
    "signature": "base64url(EdDSA_sign(clinician_private_key, ...))"
  },
  "clinicalJustification": {
    "reasonCode": "cardiac_arrest",
    "freeText": "Patient arrived unresponsive, no pulse, CPR in progress.",
    "assertedAt": "2026-07-15T09:14:00Z"
  },
  "requestedScope": ["blood_type", "allergies", "current_medications"],
  "requestSignature": "base64url(EdDSA_sign(clinician_private_key, SHA256(canonical_json(body_minus_this_field))))"
}
```

**Permitted scopes:** `blood_type`, `allergies`, `current_medications`, `emergency_contacts`.
**Forbidden, always, regardless of reason code:** `mental_health`, `reproductive`, `genetic`, `full_record` → `403 scopeNotPermitted`.

**Canonicalization convention (Month 3 build decision — not specified by
v0.2):** `requestSignature` is computed over `SHA256(canonical_json(body
minus the requestSignature field))`, where `canonical_json` recursively
sorts object keys before serializing (`lib/canonical-json.ts`). v0.2
specifies signing over a SHA-256 hash of the body but does not itself
mandate a key-ordering convention; both the resolver and any client
software must use this exact canonicalization for signatures to verify.

### ProviderJWT

Signed by the clinician's key — not the facility's — so the audit trail
identifies the individual, not just the institution. **Month 3
simplification, explicitly sanctioned:** there is no separate clinician key
registry yet (Month 4+); ProviderJWTs are verified against the same
facility public key used for standard facility JWTs.

| Claim | Notes |
|---|---|
| `iss` | Individual clinician DID. Must equal `providerCertificate.providerId`. |
| `aud` | Must be exactly `https://resolver.huuid.health/break-glass` — **not** `.../resolver`. |
| `exp - iat` | `<= 120` seconds — **half** the standard facility JWT window. Emergencies are immediate; a longer window suggests a pre-prepared (non-genuine) request. |
| `jti` | Must equal `X-HUUID-Request-ID`. |

### Success response — `200 OK`

Headers: `X-HUUID-BG-Token-ID`, `X-HUUID-BG-Expires`,
`Cache-Control: no-store, no-cache, must-revalidate`, `Pragma: no-cache`.

```json
{
  "breakGlassTokenId": "bg-token-20260715-091422-f47ac10b",
  "huuid": "did:huuid:gh:TEST7X29ALPHAxyz001",
  "issuedAt": "2026-07-15T09:14:22Z",
  "expiresAt": "2026-07-15T09:29:22Z",
  "durationSeconds": 900,
  "scopeGranted": ["blood_type", "allergies", "current_medications"],
  "emergencyData": {
    "bloodType": "O+",
    "criticalAllergies": [{ "substance": "Penicillin", "reaction": "anaphylaxis", "severity": "life-threatening" }],
    "currentMedications": [{ "name": "Metformin", "dose": "500mg", "frequency": "twice daily" }]
  },
  "auditDeclaration": {
    "auditEntryId": "bg-audit-20260715-091422-f47ac10b",
    "accessedBy": "did:huuid:gh:clinician-dr-ama-owusu-001",
    "accessedAt": "2026-07-15T09:14:22Z",
    "patientNotificationStatus": "queued",
    "patientNotificationETA": "2026-07-15T09:15:22Z"
  }
}
```

The 15-minute token is a hard limit — it cannot be refreshed or extended.
A clinician needing a different scope after expiry must file a new request
(which consumes another slot of the rate-limit ceiling).

**Month 3: `emergencyData` is mock data** (`bloodType: 'O+'`, a fixed
Penicillin allergy, a fixed Metformin prescription — shaped by
`scopeGranted`, not real patient data). Fetching real data from a
facility's EMR via DID document service endpoints is Month 4+.

### Error responses

All error responses use `Content-Type: application/json` and
`Cache-Control: no-store, no-cache, must-revalidate` (not the W3C DID
Resolution error shape used by standard resolution — Break-Glass has its
own, simpler error body: `{ "error": "...", "errorMessage": "...", ...extra }`).

| HTTP | `error` | Trigger | Notes |
|---|---|---|---|
| 400 | `invalidRequest` | Missing/invalid header, bad `reasonCode`, malformed or incomplete body | **No audit row is written** — the table's NOT NULL columns (token, scope, etc.) assume a token was actually issued. |
| 401 | `unauthorized` | ProviderJWT missing/expired/wrong audience/`exp-iat > 120s`/`jti` mismatch/`iss` != `providerCertificate.providerId`, or unknown facility | No audit row. |
| 401 | `invalidSignature` | `requestSignature` does not verify against the facility public key over the canonical body | No audit row. |
| 403 | `facilityBGSuspended` | An active Break-Glass suspension exists for this facility **and** its rolling-24h request count is under 10 | See **Rate limit resolution note** below — this is deliberately distinct from the 429 case. |
| 403 | `scopeNotPermitted` | Requested scope includes `mental_health`, `reproductive`, `genetic`, or `full_record` | Never available via Break-Glass, regardless of reason code. |
| 404 | `notFound` | HUUID not in registry, or not `active` | Identical response body either way — no enumeration signal. (Constant-time timing hardening, unlike standard resolution's 150ms floor, is not yet applied here — deferred.) |
| 429 | `rateLimitExceeded` | Rolling-24h request count is already `>= 10` | Includes `reviewReference` (`SUSP-{suspension id}`) and `contactRootAuthority`. This is what a live 11th-request-in-sequence returns. |
| 500 | `internalError` | Break-Glass audit write failed | Emergency data is withheld — the response contains no patient data. Offline QR-card fallback (v0.2 §9) is the documented recovery path. |

**Rate limit resolution note — a deliberate Month 3 design decision:** the
spec's own error table lists both `403 facilityBGSuspended` ("active
suspension") and `429 rateLimitExceeded` ("11th+ request while suspended")
for what reads, on a literal pass, like the same underlying condition. Since
the suspension row is created by the same request that hits count 10, a
naive single boolean check ("is there an active suspension?") can only ever
produce one of the two codes — but the build's own acceptance checklist
requires both, independently: a facility with a pre-existing suspension
(count `< 10`, e.g. a future Root-Authority-imposed suspension) returns
`403`; a facility whose own count has reached `>= 10` returns `429` on
every request from the 11th onward. This makes both checks independently,
deterministically true rather than mutually exclusive.

### Rate limit and automatic suspension

| Count (rolling 24h) | Action |
|---|---|
| 1-9 | Normal. Request processed, audited, patient notified. |
| **10th** | **Still processed — returns 200.** Patient safety overrides security controls; this is non-negotiable. A `huuid_facility_suspensions` row is opened (`active: true`, `reason: 'bg_rate_limit_exceeded'`) as part of the same request. |
| 11th+ | `429 rateLimitExceeded` until Root Authority (HUUID Protocol Working Group) reinstates. |

### Patient notification (60-second SLA)

Every successful Break-Glass access must trigger patient notification
within 60 seconds — a hard SLA, not best-effort. A notification failure
never fails the Break-Glass response (the patient cannot be harmed by a
notification-system outage), but is logged.

**Month 3: notification channel is always `deferred`.** There is no patient
contact store yet (no phone/WhatsApp/guardian data captured at enrollment),
so every notification is queued with `channel: 'deferred'` and a placeholder
`recipient_hash`. Real SMS/WhatsApp/guardian-SMS delivery via Hubtel, and
the 30-second retry-for-24h loop on failure, are Month 4+.

`huuid_bg_audit_log.patient_notified` / `.notification_queued_at` are set
once at insert time (both `false`/`null`) and never updated — the audit log
is immutable by design. `huuid_bg_notifications` (which does support
`UPDATE`, for exactly this reason) is the authoritative, evolving record of
notification status.

### Who can read the Break-Glass audit log (v0.2 §7.1)

| Who | Sees | How |
|---|---|---|
| Root Authority (HUUID Protocol Working Group) | All Break-Glass records, all facilities | Internal service role only |
| Facility | **Cannot** see their own Break-Glass records | Must request from Root Authority — prevents cover-up |
| Patient | All Break-Glass accesses on their own HUUID | `GET /1.0/audit/my-records` with patient key *(not built — later stage)* |

This app has a single shared `service_role` key (not distinct per-facility
or per-Root-Authority database roles), so "facility cannot self-serve" is
enforced at the **application layer** — no facility-facing tool exists or
should ever be built to query `huuid_bg_audit_log` directly — rather than
by database role. `/debug/break-glass` is internal engineering tooling, not
a facility-facing surface, so it showing raw rows does not violate this.

### Offline fallback (v0.2 §9)

If Break-Glass is unreachable or returns `500`, the patient still receives
care via the physical QR card: offline token verification against a cached
resolver public key, blood type and critical allergies displayed with zero
connectivity, and a deferred audit upload (`POST
/1.0/audit/break-glass/deferred`) once connectivity returns. Not built —
this is infrastructure for a later stage; documented here because it's the
reason a `500` on this endpoint is an acceptable, designed-for outcome
rather than a failure of the protocol.

---

## Stub Integrity Alert endpoint (Month 4 — HUUID-EMR-STUB-v0.1.2 §P4)

### `POST /1.0/stub-integrity`

Receives process-integrity violation alerts from EMR Stub installations.
A Stub POSTs here when its local HMAC manifest of `src/`/`scripts/`
(signed with the facility's Ed25519 key) no longer matches its signed
baseline — see `huuid-emr-stub`'s `integrity-check.ts`.

**Signature-verified — no other auth.** The payload's EdDSA `signature`
field is verified against the reporting facility's public key
(`huuid_facilities.public_key_multibase`) before anything is written.
The signature covers the raw UTF-8 bytes of `manifestHash` directly (no
canonical-JSON pre-hash — this is a different construction from the
Break-Glass request-signature scheme; see `lib/stub-integrity-signature.ts`).
`huuid_stub_integrity_log` is a verified audit trail: every row that
exists passed signature verification against the `facilityDID` it claims.

Request body:

```json
{
  "facilityDID": "did:huuid:gh:node-test-001",
  "manifestHash": "hex string",
  "stubVersion": "0.1.2",
  "timestamp": "ISO 8601",
  "signature": "base64url EdDSA signature over manifestHash",
  "violation": true,
  "override": false
}
```

`override: true` marks an alert sent because the Stub started anyway
under `HUUID_INTEGRITY_OVERRIDE=1` despite a failed integrity check — see
`huuid-emr-stub`'s `integrity-check.ts` grace-period/override mechanism.

Verification order and responses:

1. `facilityDID` missing or malformed → `403`, `{ "received": false, "error": "…" }`, not logged.
2. `facilityDID` not found in `huuid_facilities` → `403`, not logged.
3. `manifestHash` or `signature` missing → `401`, not logged.
4. Signature does not verify against the facility's public key → `401`, not logged.
5. Verified → `200 OK`, `{ "received": true }`, row inserted with
   `signature_verified: true`.

A Stub that gets rejected already logs locally and retries on its next
scheduled check (every 6 hours) or next startup — there is no separate
retry-on-reject path server-side.

---

## Supporting endpoints

### `GET /api/health`

Unauthenticated health probe. `200` when healthy, `503` when the database is down.
Includes Break-Glass table counts (Month 3):

```json
{
  "status": "ok", "timestamp": "…", "version": "1.0.0", "database": "connected",
  "services": { "supabase": "ok" },
  "breakGlass": { "bg_audit_log": 12, "bg_rate_limit": 12, "facility_suspensions_active": 0 }
}
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

### `GET /debug/break-glass`

Temporary raw-data debug page (Build Rule 4). Shows: an explicit form that
triggers one real, valid Break-Glass request on demand (this **does**
consume a rate-limit slot — deliberately not automatic on page load);
auto-run scenarios for expired ProviderJWT, tampered/invalid
`requestSignature`, and forbidden scope (none of which consume a rate-limit
slot, since they all fail before Step 6's record insert); the test
facility's current suspension status and rolling-24h rate-limit counter;
and the last 10 rows of `huuid_bg_audit_log`, `huuid_bg_rate_limit`, and
`huuid_bg_notifications`. **Remove before public launch.**

The destructive 10-request-then-suspend-then-11th-returns-429 sequence
(and the independent "already suspended" 403 check) are verified via a
dedicated one-time script, not run automatically by this page — this page
shows the *resulting* state (counter, suspension row) after that script
runs, not the sequence itself.

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

## Break-Glass audit log schema (`huuid_bg_audit_log`)

Separate from the standard `huuid_audit_log` — stricter, purpose-built for
legal proceedings. Immutable: `service_role` SELECT + INSERT only, no
UPDATE, no DELETE, enforced by database trigger (same pattern as the
standard audit log). Only written when a request makes it all the way to a
successful token issuance — every 400/401/403/404/429/500 path leaves no
row here, since the NOT NULL columns (`token_id`, `scope_granted`, etc.)
only make sense once a token actually exists.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `audit_entry_id` | text | Unique. Format: `bg-audit-YYYYMMDD-HHmmss-{requestId[0:8]}` |
| `request_id` | uuid | From `X-HUUID-Request-ID` |
| `huuid` | text | The patient's HUUID |
| `clinician_did` | text | The individual clinician (ProviderJWT `iss`) — not the facility |
| `clinician_license` | text | From `providerCertificate.licenseNumber` |
| `facility_did` | text | From `X-HUUID-Facility` |
| `facility_code` | text | From `providerCertificate.facilityId` |
| `reason_code` | text | `cardiac_arrest` \| `respiratory_failure` \| `trauma` \| `unconscious` \| `anaphylaxis` \| `stroke` \| `other` |
| `scope_requested` | text[] | As submitted in the request body |
| `scope_granted` | text[] | Post-forbidden-scope-filter (a request with any forbidden scope never reaches this table at all — it's rejected at 403 before Step 6) |
| `token_id` | text | `bg-token-YYYYMMDD-HHmmss-{requestId[0:8]}` |
| `token_issued_at` / `token_expires_at` | timestamptz | Issued + exactly 900s |
| `patient_notified` | boolean | Always `false` at insert — see **Patient notification** above; not kept in sync |
| `notification_queued_at` | timestamptz | Always `null` at insert, same reason |
| `provider_cert_signature` | text | `providerCertificate.signature`, as submitted |
| `request_signature` | text | The verified `requestSignature`, as submitted |
| `ip_hash` | text | SHA-256 of requester IP |
| `response_time_ms` | integer | |
| `resolver_version` | text | |
| `created_at` | timestamptz | |

## Break-Glass rate limit schema (`huuid_bg_rate_limit`)

`service_role`: SELECT + INSERT only — **no UPDATE, no DELETE**. One row
per processed (200) request. `suspended` is set `true` only on the row that
triggers suspension (the 10th) — it is a point-in-time annotation on that
row, not a live flag; ongoing enforcement reads `huuid_facility_suspensions
.active`, computed fresh on every request, not this column.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `facility_did` | text | |
| `triggered_at` | timestamptz | |
| `request_id` | uuid | |
| `suspended` | boolean | `true` only on the 10th row |

## Break-Glass notifications schema (`huuid_bg_notifications`)

`service_role`: SELECT, INSERT, **UPDATE** — the only Break-Glass table that
supports UPDATE, since it's the authoritative, evolving record of
notification delivery status (the audit log's copies are not kept in sync
— see **Patient notification** above).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `bg_audit_id` | text | FK → `huuid_bg_audit_log.audit_entry_id` |
| `channel` | text | `sms` \| `whatsapp` \| `guardian_sms` \| `deferred`. Month 3: always `deferred` — no patient contact store yet. |
| `status` | text | `queued` \| `sent` \| `failed` \| `deferred` |
| `queued_at` / `sent_at` | timestamptz | |
| `retry_count` | integer | |
| `recipient_hash` | text | SHA-256 — Month 3 uses a placeholder hash, no real contact captured yet |

## Facility suspensions schema (`huuid_facility_suspensions`)

Break-Glass-specific suspension — **distinct from**
`huuid_facilities.certificate_status` (Hours 61-80), which governs standard
GET resolution only. A facility can be fully active for standard resolution
while its Break-Glass capability specifically is suspended for rate-limit
abuse. `service_role`: SELECT, INSERT, UPDATE (for reinstatement).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `facility_did` | text | |
| `reason` | text | Always `bg_rate_limit_exceeded` in Month 3 — no manual-suspension tooling yet |
| `suspended_at` | timestamptz | |
| `suspended_by` | text | Default `'system'` |
| `reinstated_at` | timestamptz | Set on manual reinstatement (no tooling yet — direct DB update only) |
| `active` | boolean | The authoritative suspension flag, checked fresh on every Break-Glass request |

## Stub integrity log schema (`huuid_stub_integrity_log`)

Month 4 (P4). Append-only report log from `POST /1.0/stub-integrity`.
Every row has passed signature verification against the `facility_did`
it claims — see that section above. `service_role`: SELECT, INSERT only.
Not (yet) declared immutable with a trigger the way `huuid_audit_log`/
`huuid_bg_audit_log` are — revisit if this log becomes evidentiary rather
than operational/diagnostic.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `facility_did` | text | Verified against `huuid_facilities.public_key_multibase` before insert (migration 007) |
| `manifest_hash` | text | The Stub's locally-computed manifest hash at the time of the violation |
| `stub_version` | text | |
| `reported_at` | timestamptz | |
| `violation` | boolean | Always `true` for alerts sent by the current Stub build (no "all clear" pings) |
| `override` | boolean | `true` when the Stub started anyway under `HUUID_INTEGRITY_OVERRIDE=1` (migration 008) |
| `signature_verified` | boolean | `not null default false`; always `true` on rows inserted after migration 007 — rows can only be inserted post-verification |
| `ip_hash` | text | SHA-256 — never the raw IP |

---

## Deployment region

`vercel.json` pins the Vercel deployment to `cdg1` (Paris) — the closest
Vercel region to the shared Supabase project (`eu-west-1`, Ireland). Added
Hours 81+ to close the 404-vs-410 timing gap; see **Constant-time
resolution outcomes** above for the measured before/after.

---

## Environment variables

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anon key (no table access — everything is service-role) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Resolver DB access. Never in client code, never logged. |
| `HUUID_RESOLVER_VERSION` | Server | Version stamped into responses and audit rows |
| `HUUID_TEST_FACILITY_JWK` | **Server only** | Ed25519 private key (JWK JSON) for the seeded test facility. Used exclusively by `/debug/resolver` and `/debug/break-glass` to sign demonstration JWTs, ProviderJWTs, and Break-Glass `requestSignature`s. Never committed. |

---

## Deferred to later build stages

- Rolling rate limits + `Retry-After` (Treatment/Administrative)
- Standard-resolver Emergency-purpose threshold automation (>10/24h → certificate suspension) — distinct from the dedicated Break-Glass endpoint's own rate limiter, shipped Month 3
- Full JWT `iss`/`kid` chain validation beyond `sub`/`aud`/`exp`/`iat`/`jti`
- `huuid_request_log` retention/purge job (rows currently accumulate indefinitely)

**Break-Glass (Month 3), specifically:**

- Per-clinician key management (`ProviderJWT` verified against the facility
  key as a Month 3 stand-in — see **ProviderJWT** above)
- Real emergency data fetch from facility EMR/service endpoints
  (`emergencyData` is mock data)
- Real patient notification delivery (SMS/WhatsApp/guardian-SMS via Hubtel;
  Month 3 always queues `channel: 'deferred'`) and the 30-second
  retry-for-24h loop on failure
- `huuid_reason_code` (ProviderJWT claim) cross-checked against
  `X-HUUID-BG-Reason` header and `clinicalJustification.reasonCode`
- `providerCertificate.facilityId` cross-checked against `X-HUUID-Facility`
  (not currently required — the header alone is authoritative for key
  lookup, so a mismatch here doesn't grant extra privilege, but isn't
  flagged either)
- Constant-time hardening for Break-Glass `404` (unlike standard
  resolution's 150ms floor)
- Root Authority webhook on suspension trigger (v0.2 mentions this; no
  webhook infrastructure exists yet)
- Manual suspension/reinstatement tooling — `huuid_facility_suspensions
  .reason` is always `'bg_rate_limit_exceeded'` today
- `GET /1.0/audit/my-records` (patient self-access to their own Break-Glass
  history) and `POST /1.0/audit/break-glass/deferred` (offline QR-card
  fallback upload)
- TLS 1.3-only enforcement (v0.2 requires it for this endpoint specifically)
  — an edge/CDN-level negotiation setting outside what Next.js app code on
  standard Vercel controls, same known gap as the standard resolver

**Stub Integrity (Month 4), specifically:**

- Immutability trigger on `huuid_stub_integrity_log` (unlike `huuid_audit_log`
  / `huuid_bg_audit_log`) — currently an operational/diagnostic log, not an
  evidentiary one
- Alerting/paging the Root Authority on a real violation (rows are logged
  to Supabase only; no notification path to a human yet)

Signature verification on `POST /1.0/stub-integrity` is **closed**, not
deferred — see **Stub Integrity Alert endpoint** above and
`huuid-emr-stub/docs/TECHNICAL-DECISIONS.md` §11.
