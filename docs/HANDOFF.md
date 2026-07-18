# HUUID Resolver — Session Handoff

Everything a new Claude Code session needs to continue this build without
losing context. Read this file in full before touching code.

> **Two flagged discrepancies — resolve before citing either fact externally.**
> See § 13 at the end of this document. Do not silently pick one side of
> either discrepancy without checking with the operator first.

---

## 1. Project identity

| | |
|---|---|
| Project | HUUID Resolver |
| Production URL | https://huuid-resolver.vercel.app |
| GitHub | https://github.com/7evenbillion/huuid-resolver |
| W3C | `did:huuid` — DID Extensions PR #722 (see § 13 — merge date conflict) |
| Root Authority | HUUID Protocol Working Group |
| Contact | josephtdnarnor@gmail.com |
| Stack | Next.js 14 (App Router, TypeScript strict), Supabase (Postgres), Vercel |
| Region | Vercel `cdg1` (Paris) · Supabase `eu-west-1` (Ireland) — co-located deliberately, see § 7 |
| Repo root | `C:\2026\Claude Projects 2026\HUUID\huuid-resolver` — an older, stale scaffold also exists at `C:\2026\Claude Projects 2026\huuid-resolver`; do not build there |
| Spec `.docx` files | One level up, in `C:\2026\Claude Projects 2026\HUUID\` |
| Supabase project | Shared Cedimaker ecosystem project, named **"rewire"** (id `vqkkpydhfkbvaidmuqdi`) — despite the name, hosts ~30 prefixed apps. Not a HUUID-dedicated project. |
| Vercel project | `huuid-resolver`, projectId `prj_hrD2jvIZUg5wmshJUMsNdOufB37G`, teamId `team_K4PbaqkmTIdiuQRwQz4A7OWz` |

---

## 2. Completion state

**Month 1 — COMPLETE.** W3C registration; protocol spec documents (v0.2,
including the 7 corrections in `docs/CORRECTIONS.md` and the fuller
`HUUID-CORRECTIONS-REGISTER-v0.2.docx` in the spec folder).

**Month 2 — COMPLETE (Hours 31-80).**
- Base resolver `GET /1.0/identifiers/{did}`
- Ed25519 JWT verification (facility JWT, 300s window)
- Facility certificate status enforcement (`huuid_facilities.certificate_status`)
- Duplicate request detection — single-round-trip upsert pattern (`ON CONFLICT DO NOTHING RETURNING id`)
- Constant-time 404/410 hardening — 150ms floor + region co-location; **43ms aggregate median** in production (target was <50ms), down from an erratic 27-182ms range when only DB round-trip count was reduced
- Region co-location fix: `vercel.json` pins the deployment to `cdg1`

**Month 3 — COMPLETE.** Break-Glass POST endpoint.
- `POST /1.0/identifiers/{did}/break-glass` — the only POST endpoint in HUUID
- ProviderJWT verification (120s window, `aud=.../break-glass`, verified against the facility key as a sanctioned Month 3 stand-in for per-clinician keys — see § 8)
- Rate limit: 10/24h ceiling, 10th request still processed (patient safety), suspends from the 11th
- Automatic suspension triggered at the 10th request
- `huuid_bg_audit_log` (immutable — separate, stricter than the standard audit log)
- `huuid_bg_notifications` (`queued` → `deferred` channel — no patient contact store yet)
- `/debug/break-glass` page

**Month 4 — NOT STARTED.** EMR Stub middleware.

**Month 5 — NOT STARTED.** Security stress testing.

**Month 6 — NOT STARTED.** Pilot readiness.

---

## 3. All database tables

| Table | Purpose |
|---|---|
| `huuid_did_documents` | DID documents registry |
| `huuid_audit_log` | Immutable standard-resolution audit trail |
| `huuid_facilities` | Facility certificates and public keys |
| `huuid_request_log` | Duplicate-request detection (standard resolver) |
| `huuid_bg_audit_log` | Immutable Break-Glass audit trail |
| `huuid_bg_rate_limit` | Break-Glass rate-limit tracking (10/24h) |
| `huuid_bg_notifications` | Patient notification queue |
| `huuid_facility_suspensions` | Break-Glass-specific facility suspension records |

All tables: RLS enabled, zero anon/authenticated access, explicit GRANT
blocks (required post May 30 2026 Supabase change — see § 7).

## 4. Immutable tables (no UPDATE, no DELETE, ever)

- `huuid_audit_log`
- `huuid_bg_audit_log`

Both enforced two ways: RLS + GRANTs restrict `service_role` to
SELECT/INSERT only, **and** a `BEFORE UPDATE`/`BEFORE DELETE` database
trigger raises an exception even for a role that bypasses RLS. Belt and
braces — do not remove either layer.

## 5. All migration files

| File | Contents |
|---|---|
| `001_initial.sql` | `huuid_did_documents`, `huuid_audit_log`, test DID document seed |
| `002_huuid_facilities.sql` | `huuid_facilities` table, seeded test facility (`did:huuid:gh:node-test-001`) |
| `003_request_log.sql` | `huuid_request_log` — duplicate-detection table |
| `004_seed_revoked_test_document.sql` | Second test DID document, `status: revoked` — needed to test 404-vs-410 timing with a real revoked record |
| `005_break_glass.sql` | All 4 Break-Glass tables — `huuid_bg_audit_log`, `huuid_bg_rate_limit`, `huuid_bg_notifications`, `huuid_facility_suspensions` |

## 6. Environment variables (names only)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HUUID_RESOLVER_VERSION`
- `HUUID_TEST_FACILITY_JWK`

All 5 confirmed present in Vercel across Production, Preview, and
Development scopes as of this handoff. `SUPABASE_SERVICE_ROLE_KEY` and
`HUUID_TEST_FACILITY_JWK` are server-side only, guarded by `server-only`
imports (`lib/supabase-server.ts`, `lib/test-facility-jwt.ts`,
`lib/test-provider-jwt.ts`). Never commit real values — `.env.local` is
gitignored; `.env.example` holds placeholders only.

## 7. Architecture decisions — locked

- GET for resolution only. POST for Break-Glass only (the only POST in the system).
- Audit writes happen BEFORE the response, always.
- If the audit write fails, return `500` — no data returned. No exceptions.
- Service role is server-side only, never shipped to the client.
- `cache: 'no-store'` on ALL Supabase requests (`lib/supabase-server.ts`
  overrides the client's `global.fetch`). **This is a real bug fix, not a
  precaution** — Next.js's automatic fetch caching/memoization was
  observed serving stale reads (a suspended facility kept resolving `200`)
  and deduping intentional identical-request-twice self-fetches in debug
  tooling (masking a `409` that was actually correct). Any new self-fetch
  or Supabase-read code added to this app must account for this.
- Three consent tracks — A/B/C — all equal, no default:
  - **Track A** — Physical-Present-Consent (patient conscious and present, routine)
  - **Track B** — Break-Glass (patient incapacitated)
  - **Track C** — Guardian Proxy (minor or legally incapacitated adult)
- 120s JWT window for Break-Glass (ProviderJWT) — half the standard window, a fraud-detection control, not a usability constraint.
- 300s JWT window for standard resolution (facility JWT).
- The 10th Break-Glass request in a 24h window is **always processed** — patient safety overrides security controls. Non-negotiable.
- Explicit GRANT blocks required on every table (Supabase's May 30 2026 breaking change — omitting them causes a silent permission-denied error with no exception thrown).
- Deployment region pinned to `cdg1` via `vercel.json` — co-located with Supabase `eu-west-1` specifically to keep DB round-trip latency low and consistent. This was a measured fix (see § 2, Month 2) for a real production timing-side-channel problem, not a default choice — do not remove it without re-measuring 404-vs-410 timing.

## 8. Known deferred items

- `emergencyData` in the Break-Glass response is **mock data**, shaped by `scopeGranted` (fixed blood type, fixed allergy, fixed medication) — real EMR fetch from facility service endpoints is Month 4+.
- Patient notifications always queue with `channel: 'deferred'` — there is no patient contact store yet (no phone/WhatsApp/guardian data captured at enrollment). Real SMS/WhatsApp/guardian-SMS delivery via Hubtel, and the 30-second retry-for-24h loop on failure, are Month 4+.
- Clinician key management: ProviderJWTs are verified against the **facility's** public key (`huuid_facilities.public_key_multibase`), not a separate per-clinician key registry. Explicitly sanctioned as a Month 3 simplification — real per-clinician keys are Month 4+.
- `409 duplicateRequest` is **not implemented** on the Break-Glass endpoint — the literal 12-step processing order given for Month 3 didn't include a duplicate-request-ID check for Break-Glass (unlike the standard resolver, which has one via `huuid_request_log`). Flagged as a gap, not silently added.
- Rolling rate limits (50/hour) on the standard resolver for `Treatment`/`Administrative` purpose codes — not yet enforced.
- Constant-time hardening: 43ms aggregate median delta in production (target was under 50ms) — met, but occasional cold-start-adjacent latency spikes (observed up to ~463ms on individual requests) are not fully eliminated. Not a per-request guarantee, a typical-case one.
- Break-Glass `404` responses are NOT constant-time hardened (unlike the standard resolver's 150ms floor) — deferred.
- `GET /1.0/audit/{huuid}` (facility self-service, own records only) and `GET /1.0/audit/my-records` (patient self-service) — neither built yet.
- `POST /1.0/audit/break-glass/deferred` (offline QR-card fallback upload) — not built.
- Root Authority webhook on suspension trigger — no webhook infrastructure exists yet.
- Manual suspension/reinstatement tooling — `huuid_facility_suspensions.reason` is always `'bg_rate_limit_exceeded'` today; reinstatement is a direct DB update, no UI/endpoint.
- `huuid_request_log` retention/purge job — rows accumulate indefinitely (no time-window expiry despite the column existing).
- TLS 1.3-only enforcement for the Break-Glass endpoint (spec requirement) — an edge/CDN-level negotiation setting outside what Next.js app code on standard Vercel controls. Same known gap on the standard resolver.

## 9. Security patches on record

From `docs/CORRECTIONS.md` (July 2026) and `HUUID-CORRECTIONS-REGISTER-v0.2.docx`:

- **C1** — Root Authority = HUUID Protocol Working Group (not Ghana Health Service, which is a prospective, not current, partner)
- **C2** — HUUID Foundation as the international neutral root, above any national authority
- **C3** — Three consent tracks equal; no track is the default for all scenarios
- **C4** — Audit log access model made explicit (Foundation/Root Authority: all records via service role; facility: own records only via `GET /1.0/audit/{huuid}`, not yet built; patient: own records via `GET /1.0/audit/my-records`, not yet built)
- **C5** — Response drafted for the W3C reviewer's `did:web` comparison comment, to be posted on PR #722 — **status of actually posting it is not verified by this Claude Code session; see § 13**
- **C6** — HTTP methods made explicit everywhere: GET for resolution, POST only for Break-Glass
- **C7** — `HUUID-EMR-STUB-v0.1` retirement warning added wherever the Stub is referenced. **Only `v0.1.1` is valid** (confirmed explicitly in the v0.2 corrections register — a `v0.1.2` file now also exists in the spec folder but is not mentioned there and has not been read in this repo; do not treat it as superseding v0.1.1 without reading it first)

Code-level fixes made during this build, verified in production:

- Next.js fetch-caching bug fixed (`cache: 'no-store'` override — see § 7)
- `jose` v6 compatibility confirmed (bumped from v5 mid-build; lint/typecheck/build all pass, all JWT flows re-verified)
- Region co-location (`cdg1`) — measured before/after, see § 2
- The 429-vs-403 Break-Glass suspension paths were verified **independently** in production: a pre-seeded suspension with a low request count returns `403`; the 11th request of a live 10-request sequence returns `429`. These are deliberately different code paths — see `app/api/1.0/identifiers/[did]/break-glass/route.ts` file-level comment for why a naive single check can't produce both outcomes.

## 10. All live routes

| Method | Route | Status (verified at handoff time) |
|---|---|---|
| GET | `/` | 200 |
| GET | `/api/health` | 200 |
| GET | `/1.0/identifiers/{did}` | resolver (rewrite to `/api/1.0/identifiers/[did]`) |
| POST | `/1.0/identifiers/{did}/break-glass` | Break-Glass (rewrite to `/api/1.0/identifiers/[did]/break-glass`) |
| GET | `/debug/resolver` | 200 — temporary, remove before public launch |
| GET | `/debug/break-glass` | 200 — temporary, remove before public launch |

## 11. Build discipline — enforce every session

- One layer at a time.
- Debug page before any UI.
- Audit writes before response, always.
- Service role server-only, never client.
- All checks verified in production, not localhost — localhost/dev shares the same production Supabase project (no isolated local DB; see the gotcha in § 13).
- Document timing measurements honestly — if a target isn't met, say so; don't report the one favorable batch out of several.
- Never change more than one layer at a time.
- Explicit GRANTs on every new Supabase table.

## 12. How to start the next session

Open Claude Code pointed at the HUUID local folder. First message:

> "Read HANDOFF.md first. Then read all `.docx` files in this folder.
> Then tell me the current state of the build and what comes next."

---

## 13. Flagged discrepancies — resolve before relying on either fact

**PR #722 merge date.** The original project brief (start of this Claude
Code session) stated *"W3C PR #722, merged June 2026."* This handoff
request states *"MERGED July 2026."* Neither the repo nor
`HUUID-CORRECTIONS-REGISTER-v0.2.docx` (dated July 2026, which references
PR #722 only as an open target for a reviewer-response comment — see C5
above) states an explicit merge date. **This session did not verify the
actual GitHub PR** — do not cite a merge date externally (government
pitch, W3C correspondence, etc.) until confirmed against
`github.com/w3c/did-extensions/pull/722` directly.

**C5 status.** The corrections register describes C5 as a comment
*drafted and ready to post* on PR #722 — its own language is "Post this
comment on PR #722," an instruction, not a confirmation. This handoff
request lists it as "posted" (past tense). No Claude Code session has
posted anything to that PR (no GitHub PR-commenting action occurred in
this build). If it has been posted, it was done by the operator directly
outside this tool — worth a quick confirmation before treating it as
settled in any external-facing document.

**Local dev shares production data — a recurring gotcha, not a one-off.**
`npm run dev` reads `.env.local`, which points at the same shared
production Supabase project used by the live deployment. There is no
isolated local database. Test data from local sessions (rate-limit rows,
audit rows) lands in production and can exhaust real, stateful ceilings —
this happened once already: local testing alone pushed the seeded test
facility (`did:huuid:gh:node-test-001`) to its 10/24h Break-Glass rate
limit before any deliberate production verification began. `service_role`
has no DELETE grant on `huuid_bg_rate_limit` by design (matches the spec);
resetting test data for a clean run requires the Supabase MCP's
admin-level SQL access, not the app's own credentials. Plan test sequences
for any rate-limited/stateful feature with this in mind.
