import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { verifyProviderJWT } from '@/lib/provider-jwt';
import { verifyBGRequestSignature } from '@/lib/bg-request-signature';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /1.0/identifiers/{did}/break-glass — Emergency access, Track B of
 * the three equal HUUID consent tracks (HUUID-BREAK-GLASS-API-v0.2). The
 * ONLY POST endpoint in the protocol — carries a clinician-signed body that
 * cannot travel in a GET.
 *
 * Root Authority: HUUID Protocol Working Group — josephtdnarnor@gmail.com.
 *
 * Processing order (do not reorder without re-reading the Step 3/6 note
 * below — it deliberately deviates from a naive reading of the spec to
 * make two explicit DoD requirements both independently true):
 *   1. Validate headers + parse/validate body (400, no audit row)
 *   2. Verify ProviderJWT — EdDSA, aud=.../break-glass, exp-iat<=120s,
 *      jti==X-HUUID-Request-ID, iss==providerCertificate.providerId (401)
 *   3. Rate-limit + suspension gate (429 / 403 — see note below)
 *   4. Verify requestSignature over the canonical body (401 invalidSignature)
 *   5. Reject forbidden scopes (403 scopeNotPermitted)
 *   6. Record this request in huuid_bg_rate_limit; if it is the 10th in
 *      24h, also open a huuid_facility_suspensions row (still returns 200 —
 *      patient safety overrides security controls, non-negotiable)
 *   7. Fetch the DID document (404 if missing/inactive — identical body
 *      either way, no enumeration signal)
 *   8. Build emergency data (Month 3: mock data, real EMR fetch is Month 4+)
 *   9. Generate the 15-minute scoped token
 *  10. WRITE huuid_bg_audit_log BEFORE responding (500 if it fails — no
 *      emergency data withheld... err, returned, on failure)
 *  11. Queue patient notification (awaited for reliability in a serverless
 *      runtime, but its failure never fails the Break-Glass response — see
 *      note below)
 *  12. Respond 200
 *
 * STEP 3/6 NOTE — resolving a genuine spec tension: the brief's own DoD
 * wants BOTH "403 when a facility already has an active suspension" (DoD 7)
 * AND "the 11th request in a live 10-request sequence returns 429" (DoD 9).
 * Since Step 6 is what inserts the suspension row at request #10, and Step
 * 3 (if implemented as a simple boolean "is there an active suspension
 * row" check) would fire before Step 6 gets a chance to run on request
 * #11, a single boolean check cannot produce both outcomes. Resolution:
 *   - If this facility's rolling-24h request count is already >= 10:
 *     429 rateLimitExceeded. This is what naturally happens on request #11
 *     onward in a live sequence.
 *   - Else, if an active suspension row exists anyway (count < 10 — i.e. a
 *     suspension not explained by this facility's own current count, the
 *     only way that can happen in this build is a directly-seeded row,
 *     standing in for a future Root-Authority-imposed manual suspension):
 *     403 facilityBGSuspended.
 * This makes both DoD 7 and DoD 9 independently, deterministically true.
 *
 * STEP 11 NOTE — "non-blocking" is interpreted as "a notification failure
 * never fails the Break-Glass response," not "literally fire-and-forget."
 * Vercel serverless functions cannot reliably run work after the response
 * is sent — the notification insert is awaited for reliability (DoD 3
 * requires the row to exist immediately after the call), wrapped so its
 * failure only logs, never propagates.
 */

const REASON_CODES = [
  'cardiac_arrest',
  'respiratory_failure',
  'trauma',
  'unconscious',
  'anaphylaxis',
  'stroke',
  'other',
] as const;
type ReasonCode = (typeof REASON_CODES)[number];

const PERMITTED_SCOPES = [
  'blood_type',
  'allergies',
  'current_medications',
  'emergency_contacts',
] as const;
type PermittedScope = (typeof PERMITTED_SCOPES)[number];

const FORBIDDEN_SCOPES = ['mental_health', 'reproductive', 'genetic', 'full_record'];
const RECOGNIZED_SCOPES = new Set<string>([...PERMITTED_SCOPES, ...FORBIDDEN_SCOPES]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const SUSPEND_AT_COUNT = 10;
const TOKEN_DURATION_SECONDS = 900; // 15 minutes, hard — never refreshable

const ROOT_AUTHORITY_CONTACT = 'josephtdnarnor@gmail.com';

interface ProviderCertificate {
  providerId: string;
  providerName: string;
  licenseNumber: string;
  issuingAuthority: string;
  facilityId: string;
  signature: string;
}

interface ClinicalJustification {
  reasonCode: string;
  freeText: string;
  assertedAt: string;
}

interface BGRequestBody {
  providerCertificate: ProviderCertificate;
  clinicalJustification: ClinicalJustification;
  requestedScope: string[];
  requestSignature: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requesterIpHash(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return sha256Hex(ip);
}

function timestampSlug(now: Date): string {
  return now.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHmmss
}

function bgHeaders(extra?: HeadersInit): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    ...extra,
  };
}

function bgErrorBody(error: string, errorMessage: string, extra?: Record<string, unknown>) {
  return { error, errorMessage, ...extra };
}

/** Validates request body shape/content. Returns an error message, or null if valid. */
function validateBGRequestBody(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'Request body must be a JSON object.';
  const body = raw as Partial<BGRequestBody>;

  const cert = body.providerCertificate;
  if (typeof cert !== 'object' || cert === null) {
    return 'Missing or invalid providerCertificate.';
  }
  const certFields: (keyof ProviderCertificate)[] = [
    'providerId',
    'providerName',
    'licenseNumber',
    'issuingAuthority',
    'facilityId',
    'signature',
  ];
  for (const field of certFields) {
    if (typeof (cert as ProviderCertificate)[field] !== 'string' || !(cert as ProviderCertificate)[field]) {
      return `providerCertificate.${field} is required and must be a non-empty string.`;
    }
  }

  const justification = body.clinicalJustification;
  if (typeof justification !== 'object' || justification === null) {
    return 'Missing or invalid clinicalJustification.';
  }
  if (!REASON_CODES.includes(justification.reasonCode as ReasonCode)) {
    return `clinicalJustification.reasonCode must be one of: ${REASON_CODES.join(', ')}`;
  }
  if (typeof justification.freeText !== 'string' || !justification.freeText) {
    return 'clinicalJustification.freeText is required and must be a non-empty string.';
  }
  if (typeof justification.assertedAt !== 'string' || !justification.assertedAt) {
    return 'clinicalJustification.assertedAt is required and must be an ISO timestamp string.';
  }

  if (!Array.isArray(body.requestedScope) || body.requestedScope.length === 0) {
    return 'requestedScope is required and must be a non-empty array.';
  }
  for (const scope of body.requestedScope) {
    if (typeof scope !== 'string' || !RECOGNIZED_SCOPES.has(scope)) {
      return `requestedScope contains an unrecognized scope: ${String(scope)}`;
    }
  }

  if (typeof body.requestSignature !== 'string' || !body.requestSignature) {
    return 'requestSignature is required and must be a non-empty string.';
  }

  return null;
}

function buildMockEmergencyData(scopeGranted: string[]): Record<string, unknown> {
  // Month 3: mock data. Real EMR/service-endpoint fetching is Month 4+.
  const data: Record<string, unknown> = {};
  if (scopeGranted.includes('blood_type')) {
    data.bloodType = 'O+';
  }
  if (scopeGranted.includes('allergies')) {
    data.criticalAllergies = [
      { substance: 'Penicillin', reaction: 'anaphylaxis', severity: 'life-threatening' },
    ];
  }
  if (scopeGranted.includes('current_medications')) {
    data.currentMedications = [{ name: 'Metformin', dose: '500mg', frequency: 'twice daily' }];
  }
  if (scopeGranted.includes('emergency_contacts')) {
    data.emergencyContacts = [
      { name: 'Mock Contact (Month 3 stub)', relationship: 'spouse', phone: 'REDACTED-MOCK' },
    ];
  }
  return data;
}

export async function POST(req: NextRequest, { params }: { params: { did: string } }) {
  const startTime = Date.now();
  const did = decodeURIComponent(params.did ?? '');
  const ipHash = requesterIpHash(req);

  // ── Step 1: validate headers ──
  const contentType = req.headers.get('content-type');
  const authHeader = req.headers.get('authorization');
  const facility = req.headers.get('x-huuid-facility');
  const requestIdHeader = req.headers.get('x-huuid-request-id');
  const bgReasonHeader = req.headers.get('x-huuid-bg-reason');

  const headerError = !contentType || !contentType.toLowerCase().includes('application/json')
    ? 'Header Content-Type must be application/json.'
    : !authHeader
      ? 'Missing required header: Authorization'
      : !facility
        ? 'Missing required header: X-HUUID-Facility'
        : !requestIdHeader
          ? 'Missing required header: X-HUUID-Request-ID'
          : !UUID_RE.test(requestIdHeader)
            ? 'X-HUUID-Request-ID must be a valid UUID v4'
            : !bgReasonHeader || !REASON_CODES.includes(bgReasonHeader as ReasonCode)
              ? `Missing or invalid header X-HUUID-BG-Reason. Must be one of: ${REASON_CODES.join(', ')}`
              : !did.startsWith('did:huuid:')
                ? 'Malformed DID. Expected format: did:huuid:{country}:{identifier}'
                : null;

  if (headerError) {
    // No audit entry for malformed requests (HUUID-BREAK-GLASS-API-v0.2 §8).
    return NextResponse.json(bgErrorBody('invalidRequest', headerError), {
      status: 400,
      headers: bgHeaders(),
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      bgErrorBody('invalidRequest', 'Request body is not valid JSON.'),
      { status: 400, headers: bgHeaders() }
    );
  }

  const bodyError = validateBGRequestBody(rawBody);
  if (bodyError) {
    return NextResponse.json(bgErrorBody('invalidRequest', bodyError), {
      status: 400,
      headers: bgHeaders(),
    });
  }
  const body = rawBody as BGRequestBody;
  const requestId = requestIdHeader as string;

  // ── Step 2: verify ProviderJWT (Month 3: against the facility's public
  // key — see lib/provider-jwt.ts) ──
  let facilityPublicKey: string | null = null;
  try {
    const { data: facilityRow, error: facilityLookupError } = await getServiceClient()
      .from('huuid_facilities')
      .select('public_key_multibase')
      .eq('facility_did', facility as string)
      .maybeSingle();
    if (facilityLookupError) throw new Error(facilityLookupError.message);
    facilityPublicKey = facilityRow?.public_key_multibase ?? null;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'bg_facility_lookup_failed',
        resource: 'huuid_facilities',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    return NextResponse.json(bgErrorBody('internalError', 'Facility lookup failed.'), {
      status: 500,
      headers: bgHeaders(),
    });
  }

  if (!facilityPublicKey) {
    return NextResponse.json(
      bgErrorBody('unauthorized', 'Unknown facility. Facility DID is not registered.'),
      { status: 401, headers: bgHeaders() }
    );
  }

  const jwtResult = await verifyProviderJWT(authHeader, facilityPublicKey);
  if (!jwtResult.ok) {
    return NextResponse.json(bgErrorBody('unauthorized', jwtResult.reason), {
      status: 401,
      headers: bgHeaders(),
    });
  }
  if (!jwtResult.claims.jti) {
    return NextResponse.json(
      bgErrorBody('unauthorized', 'ProviderJWT is missing jti.'),
      { status: 401, headers: bgHeaders() }
    );
  }
  if (jwtResult.claims.jti !== requestId) {
    return NextResponse.json(
      bgErrorBody('unauthorized', 'ProviderJWT jti does not match X-HUUID-Request-ID.'),
      { status: 401, headers: bgHeaders() }
    );
  }
  if (jwtResult.claims.iss !== body.providerCertificate.providerId) {
    return NextResponse.json(
      bgErrorBody('unauthorized', 'ProviderJWT iss does not match providerCertificate.providerId.'),
      { status: 401, headers: bgHeaders() }
    );
  }

  // ── Step 3: rate-limit + suspension gate (see file-level note above).
  // Month 5 atomic fix: this count is now a FAST-PATH PRE-FILTER only, not
  // the authoritative decision. It runs before the expensive signature
  // verification (Step 4) purely to reject an obviously-already-over-limit
  // facility cheaply. It can only ever be overly PERMISSIVE under a race
  // (an in-flight, not-yet-committed sibling request's row isn't counted
  // yet — the count can under-count, never over-count, since rows are only
  // ever added), so a false negative here is safe: the AUTHORITATIVE
  // check now lives in increment_bg_rate_limit (migration 010, called at
  // the former Step 6), which takes a row lock on this facility and is
  // called only after signature verification succeeds — matching the
  // original behavior where a request with an invalid signature never
  // consumed rate-limit budget. See migration 010's comment for why
  // wrapping insert+count in a stored function alone would not have fixed
  // the race without that lock — confirmed under real load: 10 truly
  // concurrent requests all read a low count before seeing each other's
  // inserts, so none of them ever computed "I am the 10th," and the
  // huuid_facility_suspensions row silently never got created even though
  // the numeric 429 ceiling still held for later requests. ──
  let priorCount = 0;
  try {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count, error: countError } = await getServiceClient()
      .from('huuid_bg_rate_limit')
      .select('id', { count: 'exact', head: true })
      .eq('facility_did', facility as string)
      .gte('triggered_at', windowStart);
    if (countError) throw new Error(countError.message);
    priorCount = count ?? 0;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'bg_rate_limit_count_failed',
        resource: 'huuid_bg_rate_limit',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    return NextResponse.json(bgErrorBody('internalError', 'Rate limit check failed.'), {
      status: 500,
      headers: bgHeaders(),
    });
  }

  async function activeSuspensionReviewReference(): Promise<string> {
    const { data } = await getServiceClient()
      .from('huuid_facility_suspensions')
      .select('id')
      .eq('facility_did', facility as string)
      .eq('active', true)
      .order('suspended_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? `SUSP-${data.id}` : 'SUSP-UNKNOWN';
  }

  if (priorCount >= SUSPEND_AT_COUNT) {
    const reviewReference = await activeSuspensionReviewReference();
    return NextResponse.json(
      bgErrorBody('rateLimitExceeded', 'Facility Break-Glass capability is rate-limited.', {
        reviewReference,
        contactRootAuthority: ROOT_AUTHORITY_CONTACT,
      }),
      { status: 429, headers: bgHeaders() }
    );
  }

  try {
    const { data: suspensionRow, error: suspensionLookupError } = await getServiceClient()
      .from('huuid_facility_suspensions')
      .select('id')
      .eq('facility_did', facility as string)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (suspensionLookupError) throw new Error(suspensionLookupError.message);
    if (suspensionRow) {
      return NextResponse.json(
        bgErrorBody('facilityBGSuspended', 'Facility Break-Glass capability is suspended.', {
          reviewReference: `SUSP-${suspensionRow.id}`,
          contactRootAuthority: ROOT_AUTHORITY_CONTACT,
        }),
        { status: 403, headers: bgHeaders() }
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'bg_suspension_lookup_failed',
        resource: 'huuid_facility_suspensions',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    return NextResponse.json(bgErrorBody('internalError', 'Suspension check failed.'), {
      status: 500,
      headers: bgHeaders(),
    });
  }

  // ── Step 4: verify requestSignature over the canonical body ──
  const { requestSignature, ...bodyWithoutSignature } = body;
  const sigResult = verifyBGRequestSignature(bodyWithoutSignature, requestSignature, facilityPublicKey);
  if (!sigResult.ok) {
    return NextResponse.json(bgErrorBody('invalidSignature', sigResult.reason), {
      status: 401,
      headers: bgHeaders(),
    });
  }

  // ── Step 5: reject forbidden scopes ──
  const forbiddenRequested = body.requestedScope.filter((s) => FORBIDDEN_SCOPES.includes(s));
  if (forbiddenRequested.length > 0) {
    return NextResponse.json(
      bgErrorBody(
        'scopeNotPermitted',
        `Scope(s) never available via Break-Glass: ${forbiddenRequested.join(', ')}`
      ),
      { status: 403, headers: bgHeaders() }
    );
  }
  const scopeGranted = body.requestedScope.filter((s) =>
    PERMITTED_SCOPES.includes(s as PermittedScope)
  );

  // ── Step 6: record this request; open a suspension at exactly the 10th.
  // Month 5 atomic fix: this is now the AUTHORITATIVE rate-limit decision
  // (Step 3 above is only a fast-path pre-filter). increment_bg_rate_limit
  // (migration 010) takes a row lock on this facility so concurrent
  // callers serialize through the count one at a time, then atomically
  // records the request, marks it `suspended` if it is the 10th, and opens
  // the huuid_facility_suspensions row in the SAME transaction if this is
  // exactly the 10th — the exact step Load Test 3 found could be silently
  // skipped under true concurrency. Returns NULL when the facility is
  // already at/over the ceiling (this request is deliberately not
  // recorded, matching the original behavior for the 11th+ request). ──
  try {
    const { data: rpcResult, error: rpcError } = await getServiceClient().rpc('increment_bg_rate_limit', {
      p_facility_did: facility as string,
      p_request_id: requestId,
    });
    if (rpcError) throw new Error(rpcError.message);

    if (rpcResult === null) {
      const reviewReference = await activeSuspensionReviewReference();
      return NextResponse.json(
        bgErrorBody('rateLimitExceeded', 'Facility Break-Glass capability is rate-limited.', {
          reviewReference,
          contactRootAuthority: ROOT_AUTHORITY_CONTACT,
        }),
        { status: 429, headers: bgHeaders() }
      );
    }
    // 10th request is STILL processed — patient safety overrides security
    // controls. Non-negotiable. Continue to Step 7 regardless of the
    // returned count (the function already recorded suspended/opened
    // huuid_facility_suspensions internally if this was exactly the 10th).
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'bg_rate_limit_record_failed',
        resource: 'huuid_bg_rate_limit',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    return NextResponse.json(bgErrorBody('internalError', 'Rate limit recording failed.'), {
      status: 500,
      headers: bgHeaders(),
    });
  }

  // ── Step 7: fetch the DID document ──
  let record: { did_document: Record<string, unknown>; status: string } | null = null;
  try {
    const { data, error } = await getServiceClient()
      .from('huuid_did_documents')
      .select('did_document, status')
      .eq('huuid', did)
      .maybeSingle();
    if (error) throw new Error(error.message);
    record = data;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'bg_did_lookup_failed',
        resource: 'huuid_did_documents',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    return NextResponse.json(bgErrorBody('internalError', 'DID document lookup failed.'), {
      status: 500,
      headers: bgHeaders(),
    });
  }

  if (!record || record.status !== 'active') {
    // Identical response body regardless of never-existed vs revoked — no
    // enumeration signal. (Constant-time hardening is deferred; see api.md.)
    return NextResponse.json(bgErrorBody('notFound', 'HUUID not found in registry.'), {
      status: 404,
      headers: bgHeaders(),
    });
  }

  // ── Step 8: build emergency data (Month 3 mock) ──
  const emergencyData = buildMockEmergencyData(scopeGranted);

  // ── Step 9: generate the 15-minute scoped token ──
  const now = new Date();
  const slug = timestampSlug(now);
  const tokenId = `bg-token-${slug}-${requestId.slice(0, 8)}`;
  const issuedAt = now;
  const expiresAt = new Date(now.getTime() + TOKEN_DURATION_SECONDS * 1000);

  // ── Step 10: WRITE huuid_bg_audit_log BEFORE responding ──
  const auditEntryId = `bg-audit-${slug}-${requestId.slice(0, 8)}`;
  let auditWritten = false;
  try {
    const { error: auditError } = await getServiceClient().from('huuid_bg_audit_log').insert({
      audit_entry_id: auditEntryId,
      request_id: requestId,
      huuid: did,
      clinician_did: jwtResult.claims.iss,
      clinician_license: body.providerCertificate.licenseNumber,
      facility_did: facility as string,
      facility_code: body.providerCertificate.facilityId,
      reason_code: body.clinicalJustification.reasonCode,
      scope_requested: body.requestedScope,
      scope_granted: scopeGranted,
      token_id: tokenId,
      token_issued_at: issuedAt.toISOString(),
      token_expires_at: expiresAt.toISOString(),
      patient_notified: false,
      notification_queued_at: null,
      provider_cert_signature: body.providerCertificate.signature,
      request_signature: requestSignature,
      ip_hash: ipHash,
      response_time_ms: Date.now() - startTime,
      resolver_version: RESOLVER_VERSION,
    });
    if (auditError) throw new Error(auditError.message);
    auditWritten = true;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'bg_audit_write_failed',
        resource: 'huuid_bg_audit_log',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
  }

  if (!auditWritten) {
    // Emergency data is withheld if the audit cannot be written. Patient
    // safety fallback: the offline QR card (HUUID-BREAK-GLASS-API-v0.2 §9).
    return NextResponse.json(
      bgErrorBody(
        'internalError',
        'Audit write failed. Resolution aborted — no Break-Glass access without an audit trail. Use the offline QR card fallback.'
      ),
      { status: 500, headers: bgHeaders() }
    );
  }

  // ── Step 11: queue patient notification. Awaited for reliability in a
  // serverless runtime; its failure never fails the Break-Glass response
  // (see file-level note above).
  //
  // huuid_bg_audit_log is immutable (no UPDATE, ever — migration 005), so
  // its patient_notified/notification_queued_at columns are set once at
  // insert time (Step 10, both left false/null) and never touched again.
  // huuid_bg_notifications — which does support UPDATE, for exactly this
  // reason — is the authoritative, evolving record of notification status;
  // the audit row's copies are a point-in-time echo, not kept in sync. ──
  const notificationQueuedAt = new Date();
  let notificationStatus: 'queued' | 'deferred' = 'queued';
  try {
    const { error: notifyError } = await getServiceClient().from('huuid_bg_notifications').insert({
      bg_audit_id: auditEntryId,
      channel: 'deferred', // Month 3: no real patient contact store yet — see api.md
      status: 'queued',
      recipient_hash: sha256Hex(`${did}:${auditEntryId}`), // placeholder — no real contact captured yet
    });
    if (notifyError) throw new Error(notifyError.message);
  } catch (err) {
    notificationStatus = 'deferred';
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'bg_notification_queue_failed',
        resource: 'huuid_bg_notifications',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
  }

  // ── Step 12: respond ──
  return NextResponse.json(
    {
      breakGlassTokenId: tokenId,
      huuid: did,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      durationSeconds: TOKEN_DURATION_SECONDS,
      scopeGranted,
      emergencyData,
      auditDeclaration: {
        auditEntryId,
        accessedBy: jwtResult.claims.iss,
        accessedAt: issuedAt.toISOString(),
        patientNotificationStatus: notificationStatus,
        patientNotificationETA: new Date(notificationQueuedAt.getTime() + 60_000).toISOString(),
      },
    },
    {
      status: 200,
      headers: bgHeaders({
        'X-HUUID-BG-Token-ID': tokenId,
        'X-HUUID-BG-Expires': expiresAt.toISOString(),
      }),
    }
  );
}
