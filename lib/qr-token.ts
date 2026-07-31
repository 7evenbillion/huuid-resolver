import 'server-only';
import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { canonicalJsonStringify } from '@/lib/canonical-json';

// Was 5 years (undocumented default, no TTL specified at the time).
// Operator has since specified 90 days explicitly, tied to the
// medical-profile-freshness notification feature: a shorter TTL forces
// periodic re-verification against the resolver (or a fresh card
// download) rather than letting a card silently drift for years.
// Overridable so the operator can change policy without a code change.
const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60;
const QR_TOKEN_VERSION = 1;
const QR_TOKEN_ISSUER = 'huuid-self-enrolled-v1';

interface AllergyInput {
  substance: string;
  reaction?: string | null;
  severity?: string | null;
}

interface MedicationInput {
  name: string;
  dose?: string | null;
  frequency?: string | null;
}

interface ContraindicationInput {
  substance: string;
  reason?: string | null;
  severity: 'never' | 'avoid' | 'consult';
}

export interface MedicalProfileForToken {
  bloodType?: string | null;
  allergies?: AllergyInput[];
  medications?: MedicationInput[];
  chronicConditions?: string[];
  organDonor?: string | null;
  implantedDevices?: string[];
  pregnancyStatus?: string | null;
  primaryFacilityName?: string | null;
  contraindications?: ContraindicationInput[];
}

export interface QrTokenPayload {
  v: number;
  huuid: string;
  bt?: string;
  ca?: { s: string; r?: string; sv?: string }[];
  cm?: { n: string; d?: string; f?: string }[];
  cc?: string[];
  od?: string;
  id?: string[];
  preg?: string;
  pf?: string;
  // "do not give" — contraindications with severity === 'never' only. Its
  // own top-level key (not buried inside a general contraindications list)
  // because this is the single most safety-critical field on the card.
  nd?: { s: string; r?: string }[];
  /** Epoch seconds this specific token was generated -- distinct from `exp`
   * (when it stops being honored at all). Lets a verifier that DOES have
   * connectivity judge how stale the medical data might be even before
   * outright expiry, and lets huuid-emr-stub's offline path report a
   * concrete "medical data may be outdated" warning once past `exp`. */
  gen: number;
  exp: number;
  iss: string;
}

export interface SignedQrToken extends QrTokenPayload {
  sig: string;
}

/**
 * Builds the QR payload from a patient's medical profile. Every field is
 * optional and omitted entirely when empty, keeping the token — and
 * therefore the printed QR code — as small as possible.
 */
export function buildQrTokenPayload(
  huuid: string,
  medical: MedicalProfileForToken,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): QrTokenPayload {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: QrTokenPayload = {
    v: QR_TOKEN_VERSION,
    huuid,
    gen: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    iss: QR_TOKEN_ISSUER,
  };

  if (medical.bloodType && medical.bloodType !== 'unknown') {
    payload.bt = medical.bloodType;
  }

  if (medical.allergies?.length) {
    payload.ca = medical.allergies.map((a) => ({
      s: a.substance,
      ...(a.reaction ? { r: a.reaction } : {}),
      ...(a.severity ? { sv: a.severity } : {}),
    }));
  }

  if (medical.medications?.length) {
    payload.cm = medical.medications.map((m) => ({
      n: m.name,
      ...(m.dose ? { d: m.dose } : {}),
      ...(m.frequency ? { f: m.frequency } : {}),
    }));
  }

  if (medical.chronicConditions?.length) {
    payload.cc = medical.chronicConditions;
  }

  if (medical.organDonor) {
    payload.od = medical.organDonor;
  }

  if (medical.implantedDevices?.length) {
    payload.id = medical.implantedDevices;
  }

  if (medical.pregnancyStatus) {
    payload.preg = medical.pregnancyStatus;
  }

  if (medical.primaryFacilityName) {
    payload.pf = medical.primaryFacilityName;
  }

  if (medical.contraindications?.length) {
    const nd = medical.contraindications
      .filter((c) => c.severity === 'never')
      .map((c) => ({ s: c.substance, ...(c.reason ? { r: c.reason } : {}) }));
    if (nd.length) payload.nd = nd;
  }

  return payload;
}

/**
 * PRE-PILOT BLOCKER: there is no dedicated resolver signing keypair yet.
 * HUUID_RESOLVER_PRIVATE_KEY is checked first for when one is provisioned;
 * until then this falls back to HUUID_TEST_FACILITY_JWK — the same interim
 * key already used by /api/1.0/resolver-public-key (see that route's
 * comment). A QR card signed with the interim key is cryptographically
 * indistinguishable from one signed by the seeded test facility, which is
 * NOT an acceptable production posture. Do not ship real patient cards
 * signed with this fallback.
 */
function getSigningKey(): { jwk: { kty: string; crv: string; x: string; d: string }; usingInterimKey: boolean } | null {
  const dedicated = process.env.HUUID_RESOLVER_PRIVATE_KEY;
  if (dedicated) {
    try {
      return { jwk: JSON.parse(dedicated), usingInterimKey: false };
    } catch {
      // fall through to interim key
    }
  }

  const interim = process.env.HUUID_TEST_FACILITY_JWK;
  if (!interim) return null;
  try {
    return { jwk: JSON.parse(interim), usingInterimKey: true };
  } catch {
    return null;
  }
}

/**
 * Signs a QR payload: raw EdDSA signature (not a JWT, mirroring
 * lib/bg-request-signature.ts's verify convention) over
 * SHA256(canonical_json(payload)), then deflate + base64url the whole
 * signed object for QR encoding. Returns null if no signing key is
 * configured at all (never throws on missing config — callers decide how
 * to degrade).
 */
export function signQrToken(payload: QrTokenPayload): { token: string; usingInterimKey: boolean } | null {
  const key = getSigningKey();
  if (!key) return null;

  let privateKeyObject;
  try {
    privateKeyObject = createPrivateKey({ key: key.jwk, format: 'jwk' });
  } catch {
    return null;
  }

  const canonical = canonicalJsonStringify(payload);
  const hash = createHash('sha256').update(canonical).digest();

  let signature: Buffer;
  try {
    signature = cryptoSign(null, hash, privateKeyObject);
  } catch {
    return null;
  }

  const signed: SignedQrToken = { ...payload, sig: signature.toString('base64url') };
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(signed), 'utf8'));
  return { token: compressed.toString('base64url'), usingInterimKey: key.usingInterimKey };
}

/**
 * Extracts a HUUID from a raw scanned QR value (Layer 6's "Scan QR" tab).
 * Accepts either the plain-HUUID fallback the QR may encode, or the
 * compressed signed token (deflateRaw + base64url per the wire format
 * above) — decoded here only to discover which patient to look up, NOT
 * as a trust decision: the caller must still resolve fresh data from the
 * live database. Signature verification is deliberately not performed
 * here; that's huuid-emr-stub's job for the offline path, not this
 * online facility-dashboard convenience lookup. Never throws — returns
 * null for anything unparseable.
 */
export function extractHuuidFromScannedValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^did:huuid:[a-z]{2}:[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const compressed = Buffer.from(trimmed, 'base64url');
    const inflated = inflateRawSync(compressed);
    const parsed = JSON.parse(inflated.toString('utf8')) as { huuid?: unknown };
    if (typeof parsed.huuid === 'string' && parsed.huuid.startsWith('did:huuid:')) {
      return parsed.huuid;
    }
  } catch {
    // not a valid compressed token — fall through
  }
  return null;
}
