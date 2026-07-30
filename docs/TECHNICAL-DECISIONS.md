# HUUID Resolver — Technical Decisions

This document records non-obvious technical decisions and the reasons
behind them, mirroring the sibling `huuid-emr-stub` repo's doc of the same
name. Before simplifying or replacing any of the patterns below, read the
relevant section in full.

`app/api/1.0/resolver-public-key/route.ts` and `lib/qr-token.ts` both
already referenced this file before it existed (a dangling reference left
over from the Month 4 build, which specified the doc but never created
it). This file starts at the entry that finally closes that reference.

---

## 1. Offline QR emergency token — wire format, signing, and compression

**Context.** Phase 2A ("emergency medical profile") added
`lib/qr-token.ts`: a server-side builder + signer for a compact offline
emergency payload, and `/enroll/card`'s printed QR now encodes one
instead of the plain HUUID string. This is the first thing in either
repo that actually issues a signed card — previously only
`huuid-emr-stub`'s `qr-verifier.ts` existed, written speculatively with
no real signer to test against (see that repo's `docs/TECHNICAL-
DECISIONS.md` §12). Running a real token from this builder through that
verifier this session surfaced three real cross-repo mismatches, now
fixed on the `qr-verifier.ts` side. This section is the format the two
repos agreed on; if they ever drift again, this repo is the source of
truth (the signer), not the verifier.

**Wire format:**

```
QR string := base64url( deflateRaw( JSON.stringify({
  v:      1,                                  // token version
  huuid:  "did:huuid:<cc>:<id>",
  bt?:    "O-",                               // blood type, omitted if unset/'unknown'
  ca?:    [{ s: "Penicillin", r?: "...", sv?: "..." }],  // allergies
  cm?:    [{ n: "Metformin", d?: "500mg", f?: "..." }],  // medications
  cc?:    ["Diabetes (Type 2)", ...],         // chronic conditions
  od?:    "yes" | "no" | "unknown",           // organ donor
  id?:    ["Pacemaker", ...],                 // implanted devices
  preg?:  "pregnant" | "not_pregnant" | "unknown",
  pf?:    "Korle Bu Teaching Hospital",       // primary facility name
  nd?:    [{ s: "Aspirin", r?: "G6PD deficiency" }],  // DO NOT GIVE -- severity:'never' only
  exp:    1942883961,                         // epoch seconds
  iss:    "huuid-self-enrolled-v1",
  sig:    "<base64url EdDSA signature>",
}) ) )
```

Every field except `v`, `huuid`, `exp`, `iss`, `sig` is **omitted
entirely** (not set to `null`) when the patient hasn't provided that
data — `buildQrTokenPayload()` only adds a key when there's a real value,
deliberately, to keep the printed QR as small as possible and because a
present-vs-absent key distinction is load-bearing for the signature (see
below).

**Signing:** `sig = base64url( Ed25519_sign( key, SHA256(canonical_json
(payload_without_sig)) ) )`. `canonical_json` recursively sorts object
keys (`lib/canonical-json.ts`'s `canonicalJsonStringify`, duplicated
byte-for-byte in `huuid-emr-stub`'s `qr-verifier.ts` since that's a
standalone Node service, not a package in the same workspace). This is
the **same hash-before-sign convention** already established by
`lib/bg-request-signature.ts` for Break-Glass requests — deliberately
reused rather than inventing a second signing convention for one more
feature. **Do not sign or verify over the raw canonical JSON string
directly** — that was the actual bug found on the verifier side this
session (see `huuid-emr-stub`'s §14): it made every signature fail
because Ed25519's own internal hashing was being applied to the wrong
input.

**Compression:** the signed object is `zlib.deflateRawSync()`-compressed
before base64url encoding, purely to keep the printed/scanned QR code
small. `inflateRawSync` is required on the decode side before
`JSON.parse` — a verifier that skips this step will fail at `JSON.parse`
on every real token with something like "Malformed QR token," which is
exactly what happened when this was first tested against
`huuid-emr-stub`'s pre-Phase-2A verifier.

**Why omitted fields matter for the signature, not just payload size.**
Because signing happens over `canonical_json(payload)` and a verifier
reconstructs `fieldsToVerify` by destructuring `sig` off the *parsed*
token, any verifier-side schema default (e.g. Zod's `.array(...)
.default([])`) that injects a key the signer never included (`cc: []`
where the signer omitted `cc` entirely) makes the verifier's
re-signed canonical JSON diverge from what was actually signed, and
every token with an omitted field fails verification. If a verifier
implementation (in this repo or another consumer) ever needs to parse
this payload, its optional fields must round-trip "absent stays absent"
through validation — no schema-level defaults on any of `bt`, `ca`,
`cm`, `cc`, `od`, `id`, `preg`, `pf`, `nd`.

**Signing key: still the interim one — Pre-Pilot Blocker 2, unchanged.**
`getSigningKey()` in `lib/qr-token.ts` checks
`HUUID_RESOLVER_PRIVATE_KEY` first, falling back to
`HUUID_TEST_FACILITY_JWK` — confirmed via `vercel env ls production`
that only the latter is actually set. Every QR token issued today,
including by real production enrollments, is signed with the same
interim key that `GET /1.0/resolver-public-key` has always published —
the same key the seeded test facility in `huuid_facilities` uses. This
is **not** a production-trustworthy signature yet; a dedicated
resolver-owned signing keypair (held only by the Root Authority, never
shared with JWT/ProviderJWT/Break-Glass signing) is required before
pilot. See `docs/HANDOFF.md` §18.11 for the full Phase 2A record.

**`nd` (do-not-give) is its own top-level field, not nested inside a
general contraindications list.** Deliberate: it's the single most
safety-critical field on the card (severity-`'never'` substances a
patient must not be given), and a consumer that only cares about
emergency safety should be able to read `nd` without also parsing
`ca`/`cm`/`cc`. A verifier that silently drops unrecognized top-level
keys (Zod's default behavior for unknown keys on `.object()`, absent
`.strict()`) will silently drop this field along with everything else
new — this is exactly what happened on the `huuid-emr-stub` side before
this session's fix, and is the most consequential of the three
mismatches found, not just a typing inconvenience.

**Verified this session:** a real token was built and signed via this
exact code (`buildQrTokenPayload` + `signQrToken`, invoked directly —
not reimplemented — by temporarily disabling the `import 'server-only'`
guard for a throwaway local script, reverted immediately after), signed
with the same `HUUID_TEST_FACILITY_JWK` value production uses
(`usingInterimKey: true` in the result), then verified successfully
against `huuid-emr-stub`'s fixed `qr-verifier.ts` using the live
production resolver's actual published public key (`GET
/1.0/resolver-public-key`, fetched fresh). All fields round-tripped
correctly, including `nd`. A tampered token was correctly rejected. See
`huuid-emr-stub`'s `docs/TECHNICAL-DECISIONS.md` §14 for the verifier-
side detail of what was wrong and how it was fixed.

## 2. QR token TTL is 90 days, and every token carries `gen` (generated-at)

**Decision.** `DEFAULT_TTL_SECONDS` in `lib/qr-token.ts` is `90 * 24 *
60 * 60` (exactly), replacing an earlier undocumented 5-year default
that was never explicitly specified. Every token now also carries `gen`
(epoch seconds the token was signed) alongside `exp` (epoch seconds it
stops being honored) — two different facts: `gen` is "how old is this
data," `exp` is "when does this stop working at all." Both required
keys on the resolver's own `QrTokenPayload` TypeScript interface (every
token signed from here on has both), but `gen` is `.optional()` in
`huuid-emr-stub`'s verifier schema for backward compatibility with
tokens signed before this change existed.

**Why 90 days, not something longer.** Ties directly to the medical
profile update notification feature (`docs/HANDOFF.md` §18.14): a
shorter TTL forces a card to eventually re-verify against the resolver
(tier 1-3 resolution) or get re-downloaded, rather than an offline QR
token silently carrying stale medical data for years with no signal
that anything might have changed. `huuid-emr-stub`'s verifier already
treated an expired-but-validly-signed token as `valid: true` (identity
resolution was never gated on expiry) — this just makes that state
carry a concrete, surfaced warning instead of a silent `expired: true`
a caller might not even check. See `huuid-emr-stub`'s
`TECHNICAL-DECISIONS.md` §15 for the verifier-side warning text and the
`server.ts` response-shape gap found and fixed alongside it.

**Verified:** built via the real `buildQrTokenPayload` function (not a
hand-edited payload) with default TTL — `exp - gen` on the resulting
token equals exactly 7,776,000 seconds. A second token built with
`ttlSeconds: -3600` (the function's own parameter, still real code, not
fabricated) produced a token that decodes as `expired: true` on the
verifier side, `generatedAt` correctly present on both.
