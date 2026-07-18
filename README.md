# HUUID Resolver

Production resolution engine for **`did:huuid`** — a W3C-registered health identity
method (W3C DID Extensions PR #722) built for Ghana's national healthcare identity
infrastructure.

- **Every request carries a facility-signed Ed25519 JWT.** Verified against
  the facility's registered public key (`huuid_facilities`) — signature,
  `aud`, the `exp - iat <= 300s` window, `jti == X-HUUID-Request-ID`, and
  `sub == X-HUUID-Facility` all must hold, or `401 unauthorized`.
- **Every request is audited.** The audit write happens *before* the response is
  sent; if it fails, the resolution fails with 500.
- **Every audit is immutable.** No UPDATE, no DELETE — enforced by RLS, GRANTs,
  and database triggers. Audit log access: Root Authority via service role only;
  facilities see only their own records; patients can request their own access
  history (`GET /1.0/audit/{huuid}`, scoped JWT — later build stage). The audit
  log never contains medical data.
- **Facility certificate status is enforced.** `suspended`/`revoked`
  facilities get `403 forbidden`, audited.
- **Duplicate `X-HUUID-Request-ID` is rejected with `409`** — a single-round-trip
  upsert (`ON CONFLICT DO NOTHING RETURNING id`), before any audit row is
  written (the one exception to audit-first).
- **404/410/200 response times are padded to a 150ms floor**, applied uniformly
  to blunt timing-based enumeration of whether a HUUID never existed or was
  revoked. Reducing DB round trips alone wasn't enough (measured 404-vs-410
  median delta 27-182ms in production, target under 50ms met in only 1 of 4
  batches); the deployment is now pinned to `cdg1` (Paris, via `vercel.json`)
  to co-locate with the Supabase project (`eu-west-1`), which closed the gap —
  median delta now 43ms aggregate, 19-59ms per batch. See [api.md](api.md)
  § Constant-time resolution outcomes for the full measurement history.
- **Medical data never touches this server.** DID documents are pointer maps only.
- **Break-Glass (Track B, Month 3) is live.** `POST /1.0/identifiers/{did}/break-glass`
  — the protocol's only POST — grants a 15-minute scoped emergency-access token
  to a clinician's signed request, gated by a ProviderJWT (120s window, clinician
  key, not facility key), a canonical-JSON `requestSignature`, forbidden-scope
  rejection, and a 10-request/24h ceiling that still processes the 10th request
  (patient safety overrides security controls) before suspending from the 11th
  onward. See [api.md](api.md) § Break-Glass endpoint.

## Governance

Trust hierarchy: **L0 — HUUID Foundation** (international neutral root: holds
root keys, publishes resolver software, registers national Root Authorities,
zero patient data access) → **L1 — Root Authority** → **L2 — facilities**.

Current Root Authority: **HUUID Protocol Working Group** (also acting as
Foundation) · josephtdnarnor@gmail.com. Upon successful pilot adoption,
operational control transitions to the national health authority of the
adopting country.

Consent tracks are equal — no default; the clinical situation decides:
**Track A** (patient conscious and present), **Track B** (patient
incapacitated — Break-Glass), **Track C** (minor or legal guardian).

## Stack

Next.js 14 (App Router, TypeScript strict) · Supabase (Postgres, service-role only)
· Vercel. Deployment region is pinned to `cdg1` (Paris) via `vercel.json` —
co-located with the Supabase project (`eu-west-1`) to keep DB round-trip
latency low and consistent.

## Endpoints

| Method + Route | Purpose |
|---|---|
| `GET /1.0/identifiers/{did}` | W3C DID Resolution — GET only (see [api.md](api.md)) |
| `POST /1.0/identifiers/{did}/break-glass` | Break-Glass — the protocol's only POST (Month 3, see [api.md](api.md)) |
| `GET /api/health` | Health probe (includes Break-Glass table counts) |
| `GET /debug/resolver` | Temporary raw-data debug page |
| `GET /debug/break-glass` | Temporary raw-data debug page for Break-Glass |

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values — never commit .env.local
npm run dev
```

Checks before every commit:

```bash
npm run lint
npm run type-check
npm run build
```

## Database

Migrations live in `supabase/migrations/` — eight tables with the `huuid_`
prefix (shared Cedimaker Supabase project):

- `huuid_did_documents` — DID document registry (service_role: SELECT/INSERT/UPDATE; no DELETE — deactivate only)
- `huuid_audit_log` — immutable audit trail (service_role: SELECT/INSERT only)
- `huuid_facilities` — facility registry for JWT verification + certificate status (service_role: SELECT/INSERT/UPDATE; no DELETE)
- `huuid_request_log` — replay-detection log for `X-HUUID-Request-ID` (service_role: SELECT/INSERT only)
- `huuid_bg_audit_log` — immutable Break-Glass audit trail, separate + stricter than the standard one (service_role: SELECT/INSERT only)
- `huuid_bg_rate_limit` — Break-Glass 10/24h ceiling tracking (service_role: SELECT/INSERT only)
- `huuid_bg_notifications` — Break-Glass patient-notification status (service_role: SELECT/INSERT/UPDATE)
- `huuid_facility_suspensions` — Break-Glass-specific suspension, distinct from `huuid_facilities.certificate_status` (service_role: SELECT/INSERT/UPDATE)

All tables: RLS enabled, zero anon/authenticated access, explicit GRANT blocks
(required post May 30 2026).

## Environment variables

See [.env.example](.env.example). `SUPABASE_SERVICE_ROLE_KEY` and
`HUUID_TEST_FACILITY_JWK` are server-side only — the former guarded by a
`server-only` import in `lib/supabase-server.ts`, the latter in
`lib/test-facility-jwt.ts`.

## Related specifications

- HUUID-RESOLVER-API-v0.1 (this service's standard resolution — implemented; a
  `-v0.2.docx` now also exists in the spec folder but has not been read/reviewed
  in this repo — read it before assuming it changes anything documented here)
- HUUID-RESOLUTION-SPEC-v0.1 (same caveat — a `-v0.2.docx` exists, not yet reviewed)
- **HUUID-BREAK-GLASS-API-v0.2** — this service's Break-Glass endpoint (Month 3,
  implemented, read in full this session). v0.1 is superseded by v0.2.
- **HUUID-EMR-STUB-v0.1.1** — **WARNING: v0.1 is retired and must never be
  deployed. Only HUUID-EMR-STUB-v0.1.1 is valid** (per docs/CORRECTIONS.md
  Correction 6). Note: a `HUUID-EMR-STUB-v0.1.2.docx` now also exists in the
  spec folder — not yet read/reviewed in this repo, so no claim is made
  here about whether it supersedes v0.1.1. Read it before relying on it.

See [docs/CORRECTIONS.md](docs/CORRECTIONS.md) for the protocol's permanent
correction history.
