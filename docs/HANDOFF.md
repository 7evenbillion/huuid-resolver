# HUUID Resolver + EMR Stub — Session Handoff

Everything a new Claude Code session needs to continue this build without
losing context. Read this file in full before touching code or citing any
fact from it externally.

> **The W3C PR #722 merge date flagged by every prior handoff is now
> resolved.** Independently confirmed July 13, 2026, merged by ottomorac —
> see § 15. Safe to cite externally.

---

## 1. Project identity

| | |
|---|---|
| Project | HUUID Resolver + EMR Stub |
| Resolver | https://huuid-resolver.vercel.app |
| Resolver GitHub | github.com/7evenbillion/huuid-resolver |
| Stub GitHub | github.com/7evenbillion/huuid-emr-stub |
| W3C | `did:huuid` — DID Extensions PR #722 — **MERGED July 13, 2026** by ottomorac (Otto Mora), confirmed via `gh pr view 722 --repo w3c/did-extensions`, see § 15 |
| Root Authority | HUUID Protocol Working Group |
| Contact | josephtdnarnor@gmail.com |
| Vercel region | `cdg1` (Paris) |
| Supabase region | `eu-west-1` (Ireland) — co-located with Vercel deliberately, a measured fix for a real production timing side-channel (Month 2); do not decouple without re-measuring 404-vs-410 timing |
| Supabase project | Shared Cedimaker ecosystem project "rewire" (`vqkkpydhfkbvaidmuqdi`) — hosts ~30 prefixed apps, not HUUID-dedicated |
| Vercel project | `huuid-resolver`, projectId `prj_hrD2jvIZUg5wmshJUMsNdOufB37G`, teamId `team_K4PbaqkmTIdiuQRwQz4A7OWz` |
| Resolver repo root | `C:\2026\Claude Projects 2026\HUUID\huuid-resolver` |
| Stub repo root | `C:\2026\Claude Projects 2026\HUUID\huuid-emr-stub` |
| Spec `.docx` files | One level up, in `C:\2026\Claude Projects 2026\HUUID\` |

---

## 2. Completion state

- **Month 1 — COMPLETE.** W3C registration; protocol spec documents (v0.2).
- **Month 2 — COMPLETE.** Base resolver, JWT verification, certificate status, duplicate detection, constant-time hardening, region co-location.
- **Month 3 — COMPLETE.** Break-Glass POST endpoint, ProviderJWT, 10/24h rate limit + suspension, immutable Break-Glass audit log, patient notification queue.
- **Month 4 — COMPLETE.** EMR Stub middleware — all five security layers (P1-P4 + QR, see § 8) plus resolution tier 4 (offline QR fallback).
- **Month 5 — COMPLETE**, including separate rate-limit counters per purposeCode (migration 011, advisory locks). Also includes: standard-resolution rate limiting (migration 010's predecessor gap, closed), the atomic count-then-insert race-condition fix (migration 010, row locking), `GET /1.0/audit/{huuid}`, the NHIA fraud-detection demo, and the full 8-attack red-team simulation (8/8 blocked in production, one — bulk harvest — only after a real fix).
- **Month 6 — COMPLETE.** P5 (module isolation) built and verified in the EMR Stub — see § 8. All 5 Month 6 documentation/compliance tasks done — see § 12. 8 documents produced/updated to v0.3 (EMR Stub v0.1.3).

---

## 3. All live endpoints (resolver)

| Method | Route |
|---|---|
| GET | `/` |
| GET | `/api/health` (optional Root Authority JWT unlocks `perPurposeCode` usage — Month 5) |
| GET | `/1.0/identifiers/{did}` |
| POST | `/1.0/identifiers/{did}/break-glass` |
| GET | `/1.0/resolver-public-key` |
| POST | `/1.0/stub-integrity` |
| GET | `/1.0/audit/{huuid}` |
| GET | `/debug/resolver` — temporary, remove before public launch |
| GET | `/debug/break-glass` — temporary, remove before public launch |

All `/1.0/...` paths are Next.js rewrites to `/api/1.0/...` handlers
(`next.config.mjs`) — the W3C DID Resolution spec mandates the
spec-compliant path at the root without a `/api` prefix.

---

## 4. All database tables

| Table | Notes |
|---|---|
| `huuid_did_documents` | DID document registry |
| `huuid_audit_log` | **Immutable** — standard-resolution audit trail |
| `huuid_facilities` | Facility certificates and public keys |
| `huuid_request_log` | Duplicate-request detection + per-`purpose_code` rate-limit counting (standard resolver) |
| `huuid_bg_audit_log` | **Immutable** — Break-Glass audit trail, separate and stricter than the standard one |
| `huuid_bg_rate_limit` | Break-Glass rate-limit tracking (10/24h) |
| `huuid_bg_notifications` | Patient notification queue |
| `huuid_facility_suspensions` | Break-Glass-specific facility suspension records |
| `huuid_stub_integrity_log` | **Immutable** — Stub integrity-violation alerts, signature-verified before insert |

All tables: RLS enabled, zero anon/authenticated access, explicit GRANT
blocks (required post-May-30-2026 Supabase change — omitting them causes
a silent permission-denied error, no exception thrown).

---

## 5. All migrations, in order

| File | Contents |
|---|---|
| `001_initial.sql` | `huuid_did_documents`, `huuid_audit_log`, test DID document seed |
| `002_huuid_facilities.sql` | `huuid_facilities`, seeded test facility |
| `003_request_log.sql` | `huuid_request_log` — duplicate-detection table |
| `004_seed_revoked_test_document.sql` | Second test DID document, `status: revoked` |
| `005_break_glass.sql` | All 4 Break-Glass tables |
| `006_stub_integrity.sql` | `huuid_stub_integrity_log`, `POST /1.0/stub-integrity` |
| `007_stub_integrity_sig.sql` | `signature_verified` column — closes the unsigned-alert gap |
| `008_stub_integrity_override.sql` | `override` column — records `HUUID_INTEGRITY_OVERRIDE=1` usage |
| `009_stub_integrity_immutable.sql` | Immutability trigger on `huuid_stub_integrity_log` |
| `010_atomic_rate_limit.sql` | `increment_bg_rate_limit`, `increment_resolution_rate_limit` — row-locked atomic counters |
| `011_separate_rate_limits.sql` | `purpose_code` column on `huuid_request_log`; `increment_resolution_rate_limit` rebuilt with advisory locks, scoped per (facility, purpose) |

**Filename note:** migrations 008 and 009 are named
`008_stub_integrity_override.sql` and `009_stub_integrity_immutable.sql`
on disk — confirmed against the actual `supabase/migrations/` directory
while writing this handoff, since an earlier draft of this list used
different names.

---

## 6. Architecture decisions — locked

- GET for resolution only. POST for Break-Glass only — the only POST in the system.
- Audit writes happen BEFORE the response, always. Audit write failure → `500`, no data returned, no exceptions.
- Service role is server-side only, never shipped to the client.
- `cache: 'no-store'` on ALL Supabase requests — a real bug fix (Next.js's automatic fetch caching was observed serving stale reads and deduping intentional identical-request-twice test calls), not a precaution.
- Three consent tracks — A (Physical-Present-Consent) / B (Break-Glass) / C (Guardian Proxy) — all equal, no default.
- 120s JWT window for Break-Glass (ProviderJWT) — half the standard window, a fraud-detection control.
- 300s JWT window for standard resolution (facility JWT).
- The 10th Break-Glass request in a 24h window is always processed — patient safety overrides security controls, non-negotiable.
- Row locking (`SELECT ... FOR UPDATE` on `huuid_facilities`) for atomic Break-Glass rate limiting (migration 010) — concurrent requests for the same facility serialize through the count, one at a time, in commit order.
- Advisory locks (`pg_advisory_xact_lock`, keyed on `facility_did + purpose_code`) for standard-resolution rate limiting (migration 011) — chosen over a facility-row lock specifically so Treatment and Administrative bursts for the same facility don't contend with each other.
- Separate rate-limit counters per purposeCode (migration 011):
  - Treatment: 50/hour, independent counter
  - Administrative: 50/hour, independent counter
  - Emergency: unlimited, logged for duplicate-detection but never counted against a ceiling
  - Research: `403` at the route level, before the counter is ever called
- Research's block runs BEFORE the rate-limit/duplicate-detection RPC call (moved there Month 5) — a Research request reusing an already-used request-id now gets `403`, not `409`, since Research is unconditionally rejected regardless of duplicate status.

---

## 7. Rate limit design note

Treatment and Administrative use Postgres advisory transaction locks
keyed on `facility_did + purpose_code` together
(`pg_advisory_xact_lock(hashtextextended(...))`). Same-facility,
different-purpose bursts run fully in parallel at the DB layer.
Same-facility, same-purpose concurrency still fully serializes — verified
for real: 50 Treatment + 50 Administrative fired *concurrently*
(`Promise.all`, interleaved) against one fresh facility, 50/50 succeeded
in each bucket with zero cross-contamination, and each bucket's 51st
request was independently rejected on its own quota.

This is the correct design for a global protocol where purposeCodes are
legally distinct access categories with independent accountability —
Break-Glass's simpler row-lock (migration 010) is appropriate there
because it has only one bucket per facility; standard resolution needed
the finer-grained lock once it gained multiple independent buckets.

---

## 8. EMR Stub security layers (all complete, P1-P5 + QR)

- **P1 — SQLCipher** via `@signalapp/sqlcipher`. AES-256-CBC + HMAC-SHA512 (SQLCipher's real cipher — not GCM, despite the spec naming GCM; `PRAGMA cipher='aes-256-gcm'` is silently accepted but ignored, confirmed empirically). Key derived via HKDF-SHA256 from the facility private key.
- **P2 — OS keystore** via `@napi-rs/keyring`, replacing unmaintained `keytar`. Automatic migration from legacy keytar credentials on Windows via raw `advapi32.dll` P/Invoke (`@napi-rs/keyring`'s own `Entry.withTarget()` was found broken on Windows — confirmed via a self-consistency test before building the P/Invoke fallback). keytar encodes `CredentialBlob` as UTF-8, not the Windows-native UTF-16LE — decoding as UTF-16LE produces garbage; this was confirmed against a real keytar-written credential before shipping the fix.
- **P3 — Local shared-secret authentication.** `X-Local-Auth` header, compared via SHA-256 digest + `crypto.timingSafeEqual` (not raw string `===`). 3 failures within a 60-second window triggers a 15-minute lockout.
- **P4 — Process integrity hashing.** HMAC-SHA256 manifest of `src/`/`scripts/`/`package-lock.json`, EdDSA-signed with the facility key. On a startup mismatch: 60-second countdown (real-timed, verified) then `exit(1)`, unless `HUUID_INTEGRITY_OVERRIDE=1` is set at relaunch — in which case the Stub starts, logs the override, and sends a second signed alert to the resolver with `override: true`. The 6-hour periodic recheck keeps the original soft-fail behavior (log + alert + keep running) — forcibly killing an already-running clinic server on a later recheck was judged a materially worse, unrequested risk than gating startup.
- **P5 — Least-privilege module isolation. Built and verified Month 6** (previously flagged in this document as claimed-but-not-built — that flag is now resolved). `facility-key.ts` is the only module in the codebase that ever holds raw private-key bytes; `getFacilityPrivateKeyRaw` is not exported, so reaching for raw key access from another module is a compile error. Every other module (`cache.ts`, `resolver-client.ts`, `local-auth.ts`, `integrity-check.ts`, `integrity-manifest.ts`, `resolver-key.ts`, `status.ts`) receives only its narrow slice of config via an explicit `initXModule()` call from the orchestrator (`server.ts`, or a script acting as its own orchestrator), never `loadConfig()`/`process.env` directly. Every `HUUID_`-prefixed env var is cleared after all modules are initialized, before the server accepts requests. `npm run diagnostics` verifies this for real — clears the vars itself, then checks none remain, reporting `Module isolation: ACTIVE` only when genuinely true. Commit `8f949e9` on `huuid-emr-stub` master. Full design reasoning (including why HKDF derivation, not just JWT signing, had to move into `facility-key.ts`) in `docs/TECHNICAL-DECISIONS.md` § 13.
- **QR — Offline QR card verification** (resolution tier 4). Resolver public key fetched once (`npm run download-keys`) and cached locally as `keys/resolver-public-key.json`. EdDSA signature verified fully offline — no network call. An expired-but-validly-signed token still returns blood type and allergies with a warning, rather than blocking emergency care.

---

## 9. Pre-pilot blockers (8 open items; 2 historical items now closed)

Renumbered Month 6 to match `HUUID-PREPILOT-CHECKLIST-v0.1.docx`, which
carries the full verification test + pass criteria for each. This section
stays a short pointer, not a duplicate of that document.

1. **Root Authority email notification.** Needs: a real domain for the resolver project (currently bare `*.vercel.app`, which breaks Resend SPF/DKIM per CLAUDE.md §00-B) + confirmed `RESEND_API_KEY` in Production. No integration exists in the resolver codebase at all yet.
2. **QR signing key separation.** Needs: a dedicated resolver-owned Ed25519 keypair (currently `GET /1.0/resolver-public-key` publishes the same key as the seeded test facility — a known Month 4 testing stand-in) + an actual QR card issuance endpoint on the resolver (nothing issues real cards today, only verifies them).
3. **Stub refuse-to-start on integrity violation.** The 60-second countdown/override mechanism is built and verified with real timing. Needs: real clinic feedback on whether 60 seconds is the right grace period in practice.
4. **AES-256-CBC vs GCM spec variance.** **CLOSED Month 6** — `HUUID-EMR-STUB-v0.1.3.docx` now states the real cipher (CBC+HMAC-SHA512) throughout; the code was always correct, only the spec was wrong.
5. **Real EMR fetch in Break-Glass.** `emergencyData` is still mock data (fixed blood type/allergy/medication) shaped by `scopeGranted`. Needs: actual facility EMR/service-endpoint integration.
6. **Patient contact store for SMS.** Patient notifications always queue with `channel: 'deferred'` — no phone/WhatsApp/guardian data is captured anywhere. Needs: a patient registration flow.
7. **`GET /1.0/audit/my-records`.** Patient self-access to their own audit history — not built. `GET /1.0/audit/{huuid}` (facility- and Root-Authority-scoped) shipped Month 5, but patient-facing access needs a patient authentication mechanism that doesn't exist yet.
8. **Root Authority identity keypair.** The Root Authority's facility identity (`did:huuid:gh:root-authority-hpwg`) has had its private key generated and deleted **twice** during testing (Month 5, then again Month 5/6 boundary to verify `/api/health`'s elevated view) — it has no permanent home. Needs: a permanent Ed25519 keypair generated once, stored in an OS keystore or equivalent on a machine/system the Root Authority actually controls, its public key registered in `huuid_facilities`, and the private key never deleted again. This is the key that grants cross-facility audit query access (`GET /1.0/audit/{huuid}`) and the `/api/health` elevated view — losing it permanently means losing that oversight capability, not just a testing inconvenience.

**Historical note:** the rolling 50/hour resolver rate limit (previously
listed as item 8, CLOSED) and the AES-CBC/GCM spec variance (item 4 above)
are both now resolved — this list carries only genuinely open items plus
one just-closed-this-session item, kept numbered for continuity with the
checklist document.

---

## 10. Technical decisions record

`docs/TECHNICAL-DECISIONS.md` in `huuid-emr-stub` — every load-bearing
decision documented with rejected alternatives and the reason each was
rejected. Key entries:

- `@signalapp/sqlcipher`, not `@journeyapps/sqlcipher` (the latter has no Windows build path)
- AES-256-CBC, not GCM (SQLCipher has no GCM mode — confirmed empirically, not assumed)
- `@napi-rs/keyring`, not `keytar` (unmaintained, no releases in over a year)
- Raw `advapi32.dll` P/Invoke for keytar migration (both `Entry.withTarget()` and the `Get-StoredCredential` PowerShell cmdlet were tried first and rejected — the former is buggy on Windows, the latter isn't a built-in cmdlet)
- UTF-8, not UTF-16LE, for decoding legacy keytar credentials
- `Entry.withTarget()` is broken on Windows — confirmed via a pure self-consistency test (write and read back with the same library, no keytar involved) before concluding it was a real bug, not a naming mismatch
- Advisory locks (`facility_did + purpose_code`) for parallel purposeCode rate limiting, over a facility-row lock, specifically to let independent purposeCode buckets avoid contending with each other

---

## 11. Month 5 security findings summary

- 8/8 red-team attacks blocked in production against the live resolver and a running Stub.
- Attack 4 (bulk query harvest): was **open** — standard resolution had zero rate limiting at all when Month 5 began — fixed, deployed, then reverified blocked before Part 2 proceeded.
- Race condition in the count-then-insert rate-limit check: closed with row locking (migration 010), then re-architected with advisory locks (migration 011) once counters were split per purposeCode.
- Load Test 1 (100 concurrent, 30s): 0% true error rate (5xx / connection failures) in every run, including before and after both rate-limit fixes.
- Exact rate limits enforced under concurrency — verified with real numbers, not assumed: 50/50 Treatment, 50/50 Administrative, both independently rejecting their own 51st request.
- NHIA fraud-detection demo: working end to end against production — two facilities resolving the same patient, both audit records visible via `GET /1.0/audit/{huuid}`, cross-facility view confirmed by a genuine (re-keyed) Root Authority JWT.
- Root Authority `/api/health` view: scoped correctly — verified all three cases (unauthenticated, ordinary facility JWT, genuine Root Authority JWT) against production, not just by reading the code.
- Research purpose: confirmed at the database level to have **zero** rows in `huuid_request_log`, not just a `403` response — it genuinely never reaches any counter.

---

## 12. Month 6 scope — pilot readiness

This is a documentation and compliance month. No new code features unless
a pre-pilot blocker demands one — P5 (§ 8) was the one exception, since it
was found to be a real spec/implementation gap, not documentation drift.

**Task 1 — Protocol documentation. DONE.** All five spec documents updated
to v0.3 (EMR Stub to v0.1.3): `HUUID-RESOLUTION-SPEC-v0.3.docx`,
`HUUID-RESOLVER-API-v0.3.docx`, `HUUID-BREAK-GLASS-API-v0.3.docx`,
`HUUID-EMR-STUB-v0.1.3.docx`, `HUUID-GOVERNMENT-PITCH-v0.3.docx` (baseline
pass — see Task 4). Corrections applied: W3C merge date confirmed,
AES-256-CBC not GCM, P5 marked complete, real migration filenames, new
live endpoints (`resolver-public-key`, `audit/{huuid}`, elevated
`/api/health`) documented, independent per-purposeCode rate-limit design
corrected, Pre-Pilot Blockers section added to the Resolution Spec and
Resolver API docs.

**Task 2 — Integration manual. DONE.** `HUUID-DEVELOPER-GUIDE-v0.1.docx` —
10 sections, real JS/Python EdDSA keygen + JWT-signing code matching the
resolver's actual verification logic, full error table, purposeCode guide,
10-item troubleshooting table.

**Task 3 — Compliance documentation. DONE.** `HUUID-COMPLIANCE-v0.1.docx` —
HIPAA, GDPR, Data Sovereignty, Audit Trail, Ghana-specific posture, plus an
added "What This Document Is Not" section (not a legal opinion — flagged
rather than silently omitted, given this is headed for a Ministry).

**Task 4 — Government pitch update. DONE.** `HUUID-GOVERNMENT-PITCH-v0.3.docx`
got a new "System Status — Live and Verified" section (resolver live,
W3C merged July 13 2026, 8/8 attacks blocked, 0% error rate under load,
NHIA demo complete, immutable audit trail, offline QR capability). Build
schedule shows Months 1-5 COMPLETE; Month 6 was left IN PROGRESS rather
than marked COMPLETE as instructed, since Task 5 and the final commit
hadn't happened yet at the time this section was written — flipped to
COMPLETE only once genuinely true (see § 2).

**Task 5 — Pre-pilot verification plan. DONE.**
`HUUID-PREPILOT-CHECKLIST-v0.1.docx` — all 8 blockers from § 9, each with
current state / what's needed / verification test / pass criteria /
responsible party. Blocker 4 (AES-CBC) noted CLOSED within the checklist
itself, since it was resolved by Task 1 of this same session.

---

## 13. Environment variables (names only)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HUUID_RESOLVER_VERSION`
- `HUUID_TEST_FACILITY_JWK`
- `RESEND_API_KEY` — **not yet set**, Blocker 1

Confirmed against the actual `.env.local` while writing this handoff:
exactly the first 5 are present; `RESEND_API_KEY` is absent, matching
Blocker 1's description exactly.

---

## 14. How to start the next session

Open Claude Code pointed at the HUUID folder containing all `.docx`
documents and this file. First message:

> "Read HANDOFF.md first. Then read all `.docx` files in this folder.
> Then tell me the current state and what comes next."

---

## 15. W3C PR #722 merge date — resolved Month 6

**Formerly flagged across multiple handoffs as unverified — now closed.**
Two independent confirmations, both landing on the same fact:

1. The operator checked github.com/w3c/did-extensions/pull/722 directly
   and reported: merged July 13, 2026, by ottomorac.
2. This session independently re-verified the same fact via
   `gh pr view 722 --repo w3c/did-extensions --json mergedAt,mergedBy,state`
   before writing it into any Month 6 document — returned
   `mergedAt: 2026-07-13T20:41:34Z`, `mergedBy: ottomorac`,
   `state: MERGED`. Exact match.

**July 13, 2026, merged by ottomorac (Otto Mora), is now the confirmed
date used everywhere in this document library — safe to cite externally,
including in `HUUID-GOVERNMENT-PITCH-v0.3.docx`.** No further verification
needed on this specific fact going forward, unless the PR is later
reopened or amended (unlikely for a merged PR, but note it if seen).
