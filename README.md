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
  revoked. **Open issue, not resolved:** measured in production across 4
  independent batches, the 404-vs-410 median delta ranged 27-182ms — the
  50ms target was met in only 1 of 4 batches. Cross-region jitter between
  Vercel (`iad1`) and Supabase (`eu-west-1`) on each DB round trip dominates
  the floor; see [api.md](api.md) § Constant-time resolution outcomes for
  the full measurement and remaining options.
- **Medical data never touches this server.** DID documents are pointer maps only.

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
· Vercel.

## Endpoints

| Method + Route | Purpose |
|---|---|
| `GET /1.0/identifiers/{did}` | W3C DID Resolution — GET only (see [api.md](api.md)) |
| `POST /1.0/identifiers/{did}/break-glass` | Break-Glass only *(later build stage — the protocol's only POST)* |
| `GET /api/health` | Health probe |
| `GET /debug/resolver` | Temporary raw-data debug page |

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

Migrations live in `supabase/migrations/` — four tables with the `huuid_`
prefix (shared Cedimaker Supabase project):

- `huuid_did_documents` — DID document registry (service_role: SELECT/INSERT/UPDATE; no DELETE — deactivate only)
- `huuid_audit_log` — immutable audit trail (service_role: SELECT/INSERT only)
- `huuid_facilities` — facility registry for JWT verification + certificate status (service_role: SELECT/INSERT/UPDATE; no DELETE)
- `huuid_request_log` — replay-detection log for `X-HUUID-Request-ID` (service_role: SELECT/INSERT only)

All tables: RLS enabled, zero anon/authenticated access, explicit GRANT blocks
(required post May 30 2026).

## Environment variables

See [.env.example](.env.example). `SUPABASE_SERVICE_ROLE_KEY` and
`HUUID_TEST_FACILITY_JWK` are server-side only — the former guarded by a
`server-only` import in `lib/supabase-server.ts`, the latter in
`lib/test-facility-jwt.ts`.

## Related specifications

- HUUID-RESOLVER-API-v0.1 (this service)
- HUUID-RESOLUTION-SPEC-v0.1
- HUUID-BREAK-GLASS-API-v0.1
- **HUUID-EMR-STUB-v0.1.1** — **WARNING: v0.1 is retired and must never be
  deployed. Only HUUID-EMR-STUB-v0.1.1 is valid.**

See [docs/CORRECTIONS.md](docs/CORRECTIONS.md) for the protocol's permanent
correction history.
