import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { verifyFacilityJWT } from '@/lib/facility-jwt';
import { enforceResponseTimeFloor } from '@/lib/response-time-floor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /1.0/identifiers/{did} — W3C DID Resolution endpoint (HUUID method).
 * This route is GET only. The protocol's only POST is
 * /1.0/identifiers/{did}/break-glass, for Break-Glass access exclusively
 * (later build stage) — see api.md.
 *
 * Rules enforced here (HUUID-RESOLVER-API-v0.1 + v0.2 JWT layer):
 * - Required headers: X-HUUID-Purpose (enum), X-HUUID-Facility, X-HUUID-Request-ID
 * - Authorization: Bearer {JWT} — Ed25519-signed by the facility, verified
 *   against the facility's registered public key (huuid_facilities). Checks
 *   aud, exp-iat <= 300s, jti == X-HUUID-Request-ID, sub == X-HUUID-Facility.
 *   Any failure returns 401 unauthorized (Hours 41-60 / HUUID-RESOLVER-API-v0.2).
 * - Facility certificate status (huuid_facilities.certificate_status) is
 *   enforced after JWT verification: suspended/revoked -> 403 forbidden,
 *   audited (Hours 61-80).
 * - X-HUUID-Request-ID must not repeat (huuid_request_log, single-round-trip
 *   upsert). A duplicate returns 409 duplicateRequest BEFORE any audit write
 *   (Hours 61-80, round-trip reduced Hours 81+).
 * - Research purpose is blocked (403) until Root Authority approval.
 *   Root Authority (current): HUUID Protocol Working Group. Upon successful
 *   pilot adoption, operational control transitions to the national health
 *   authority of the adopting country. See api.md § Governance and
 *   docs/CORRECTIONS.md.
 * - AUDIT WRITE BEFORE RESPONSE — if the audit write fails, the resolution
 *   fails with 500 and no DID document is returned. No exceptions.
 * - Resolution outcomes (success/notFound/deactivated) are padded to a
 *   150ms floor so 404/410/200 timings converge (Hours 61-80).
 * - Cache-Control: no-store and X-HUUID-Audit-ID on every response
 * - Requester IP is stored only as a SHA-256 hash, never raw
 */

const PURPOSE_CODES = ['Treatment', 'Administrative', 'Research', 'Emergency'] as const;
type PurposeCode = (typeof PURPOSE_CODES)[number];

type Outcome =
  | 'success'
  | 'notFound'
  | 'unauthorized'
  | 'forbidden'
  | 'deactivated'
  | 'rateLimitExceeded'
  | 'internalError'
  | 'duplicateRequest';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function auditEntryId(requestId: string, now: Date): string {
  const ts = now
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14); // YYYYMMDDHHmmss
  return `audit-${ts.slice(0, 8)}-${ts.slice(8)}-${requestId.slice(0, 8)}`;
}

function requesterIpHash(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return sha256(ip);
}

interface AuditInput {
  requestId: string;
  huuid: string;
  requestingFacility: string;
  purposeCode: PurposeCode;
  outcome: Outcome;
  breakGlass: boolean;
  responseTimeMs: number;
  ipHash: string;
}

/** Writes one immutable audit record. Returns the audit_entry_id, or null on failure. */
async function writeAudit(input: AuditInput): Promise<string | null> {
  try {
    const entryId = auditEntryId(input.requestId, new Date());
    const { error } = await getServiceClient().from('huuid_audit_log').insert({
      audit_entry_id: entryId,
      request_id: input.requestId,
      huuid: input.huuid,
      requesting_facility: input.requestingFacility,
      purpose_code: input.purposeCode,
      outcome: input.outcome,
      break_glass: input.breakGlass,
      response_time_ms: input.responseTimeMs,
      ip_hash: input.ipHash,
      resolver_version: RESOLVER_VERSION,
    });
    if (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          requestId: input.requestId,
          action: 'audit_write_failed',
          resource: 'huuid_audit_log',
          status: 500,
          message: error.message,
          timestamp: new Date().toISOString(),
        })
      );
      return null;
    }
    return entryId;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId: input.requestId,
        action: 'audit_write_threw',
        resource: 'huuid_audit_log',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    return null;
  }
}

function baseHeaders(auditId: string | null): HeadersInit {
  return {
    'Content-Type': 'application/did+ld+json',
    'Cache-Control': 'no-store',
    'X-HUUID-Audit-ID': auditId ?? 'audit-unavailable',
  };
}

function errorBody(
  error: Outcome | 'invalidRequest',
  errorMessage: string,
  requestId: string
) {
  return {
    '@context': 'https://w3id.org/did-resolution/v1',
    didDocument: null,
    didResolutionMetadata: {
      error,
      errorMessage,
      contentType: 'application/did+ld+json',
      resolvedAt: new Date().toISOString(),
      resolverVersion: `huuid-resolver/${RESOLVER_VERSION}`,
      'huuid:requestId': requestId,
    },
    didDocumentMetadata: {},
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { did: string } }
) {
  const startTime = Date.now();
  const did = decodeURIComponent(params.did ?? '');

  // ── Step 1: collect + validate headers BEFORE any DB query ──
  const purposeHeader = req.headers.get('x-huuid-purpose');
  const facility = req.headers.get('x-huuid-facility');
  const requestIdHeader = req.headers.get('x-huuid-request-id');

  const requestId =
    requestIdHeader && UUID_RE.test(requestIdHeader)
      ? requestIdHeader
      : randomUUID(); // audit continuity when the client omits/mangles the ID

  const ipHash = requesterIpHash(req);
  const purposeValid = PURPOSE_CODES.includes(purposeHeader as PurposeCode);
  // Header-validation failures are audited under Administrative so the
  // attempt is still on record without inventing a client purpose.
  const purposeForAudit: PurposeCode = purposeValid
    ? (purposeHeader as PurposeCode)
    : 'Administrative';

  const audit = (outcome: Outcome) =>
    writeAudit({
      requestId,
      huuid: did || 'invalid',
      requestingFacility: facility ?? 'missing',
      purposeCode: purposeForAudit,
      outcome,
      breakGlass: purposeForAudit === 'Emergency',
      responseTimeMs: Date.now() - startTime,
      ipHash,
    });

  const validationError = !purposeHeader
    ? 'Missing required header: X-HUUID-Purpose'
    : !purposeValid
      ? `Invalid X-HUUID-Purpose. Must be one of: ${PURPOSE_CODES.join(', ')}`
      : !facility
        ? 'Missing required header: X-HUUID-Facility'
        : !requestIdHeader
          ? 'Missing required header: X-HUUID-Request-ID'
          : !UUID_RE.test(requestIdHeader)
            ? 'X-HUUID-Request-ID must be a valid UUID v4'
            : !did.startsWith('did:huuid:')
              ? 'Malformed DID. Expected format: did:huuid:{country}:{identifier}'
              : null;

  if (validationError) {
    // Outcome enum has no 'invalidRequest'; header failures audit as 'unauthorized'.
    const auditId = await audit('unauthorized');
    if (!auditId) {
      return NextResponse.json(
        errorBody('internalError', 'Audit write failed. Resolution aborted.', requestId),
        { status: 500, headers: baseHeaders(null) }
      );
    }
    return NextResponse.json(errorBody('invalidRequest', validationError, requestId), {
      status: 400,
      headers: baseHeaders(auditId),
    });
  }

  // ── Step 2: verify the facility's Ed25519 JWT (HUUID-RESOLVER-API-v0.2) ──
  // Single round trip: public_key_multibase (JWT verification) and
  // certificate_status (Step 3) both come from this one SELECT against
  // huuid_facilities — confirmed single-query, not split (Hours 81+).
  let jwtFailureReason: string | null = null;
  let facilityCertificateStatus: string | null = null;
  try {
    const { data: facilityRow, error: facilityLookupError } = await getServiceClient()
      .from('huuid_facilities')
      .select('public_key_multibase, certificate_status')
      .eq('facility_did', facility as string)
      .maybeSingle();

    if (facilityLookupError) throw new Error(facilityLookupError.message);

    if (!facilityRow) {
      jwtFailureReason = 'Unknown facility. Facility DID is not registered.';
    } else {
      facilityCertificateStatus = facilityRow.certificate_status;
      const jwtResult = await verifyFacilityJWT(
        req.headers.get('authorization'),
        facilityRow.public_key_multibase
      );
      if (!jwtResult.ok) {
        jwtFailureReason = jwtResult.reason;
      } else if (jwtResult.claims.sub !== facility) {
        jwtFailureReason = 'JWT subject (sub) does not match X-HUUID-Facility header.';
      } else if (jwtResult.claims.jti !== requestIdHeader) {
        jwtFailureReason = 'JWT jti does not match X-HUUID-Request-ID header.';
      }
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'facility_lookup_failed',
        resource: 'huuid_facilities',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    const auditId = await audit('internalError');
    return NextResponse.json(
      errorBody('internalError', 'Facility lookup failed.', requestId),
      { status: 500, headers: baseHeaders(auditId) }
    );
  }

  if (jwtFailureReason) {
    const auditId = await audit('unauthorized');
    if (!auditId) {
      return NextResponse.json(
        errorBody('internalError', 'Audit write failed. Resolution aborted.', requestId),
        { status: 500, headers: baseHeaders(null) }
      );
    }
    return NextResponse.json(errorBody('unauthorized', jwtFailureReason, requestId), {
      status: 401,
      headers: baseHeaders(auditId),
    });
  }

  // ── Step 3: facility certificate status enforcement (Hours 61-80) ──
  if (facilityCertificateStatus === 'suspended') {
    const auditId = await audit('forbidden');
    if (!auditId) {
      return NextResponse.json(
        errorBody('internalError', 'Audit write failed. Resolution aborted.', requestId),
        { status: 500, headers: baseHeaders(null) }
      );
    }
    return NextResponse.json(
      errorBody(
        'forbidden',
        'Facility certificate is suspended. Contact HUUID Protocol Working Group: josephtdnarnor@gmail.com',
        requestId
      ),
      { status: 403, headers: baseHeaders(auditId) }
    );
  }

  if (facilityCertificateStatus === 'revoked') {
    const auditId = await audit('forbidden');
    if (!auditId) {
      return NextResponse.json(
        errorBody('internalError', 'Audit write failed. Resolution aborted.', requestId),
        { status: 500, headers: baseHeaders(null) }
      );
    }
    return NextResponse.json(
      errorBody('forbidden', 'Facility certificate has been revoked.', requestId),
      { status: 403, headers: baseHeaders(auditId) }
    );
  }

  // ── Step 4: Research purpose is blocked until Root Authority approval.
  // Month 6: moved ahead of the duplicate/rate-limit RPC call (formerly
  // Step 5, after it) so a Research request never reaches the counter at
  // all — it is unconditionally rejected regardless of duplicate-ID status,
  // matching "Research: 0, blocked at route level, never reaches counter."
  // Real, deliberate behavior change from before: a Research request that
  // happens to reuse an already-used request-id now gets 403 (forbidden)
  // rather than 409 (duplicateRequest) — since Research is unconditionally
  // rejected, checking its duplicate status first was never meaningful. ──
  if (purposeHeader === 'Research') {
    const auditId = await audit('forbidden');
    if (!auditId) {
      return NextResponse.json(
        errorBody('internalError', 'Audit write failed. Resolution aborted.', requestId),
        { status: 500, headers: baseHeaders(null) }
      );
    }
    return NextResponse.json(
      errorBody(
        'forbidden',
        'Research purposeCode is blocked pending Root Authority (HUUID Protocol Working Group) approval.',
        requestId
      ),
      { status: 403, headers: baseHeaders(auditId) }
    );
  }

  // ── Step 4.5, Month 6: separate rate-limit counters per purposeCode.
  // International protocol design decision: each purposeCode is a legally
  // distinct access category with independent budget, independent audit
  // trail, and independent accountability. Treatment and Administrative no
  // longer share one 50/hour counter per facility (Month 5's open
  // question) — each gets its own, scoped to (facility_did, purpose_code)
  // via a new column on huuid_request_log (migration 011).
  //
  // increment_resolution_rate_limit still does duplicate X-HUUID-Request-ID
  // detection AND rate-limit counting in one Postgres function call
  // (migration 010's atomic fix, unchanged in spirit) — but the lock
  // strategy changed: rather than a row lock on huuid_facilities (which
  // would serialize ALL purposes for a facility through one lock even
  // though they now count into independent buckets), migration 011 uses a
  // Postgres advisory transaction lock keyed on facility_did + purpose_code
  // together. Concurrent Treatment and Administrative requests for the SAME
  // facility no longer contend with each other at all; concurrent requests
  // for the SAME facility AND SAME purpose still fully serialize, exactly
  // as migration 010 required. See migration 011's own comment for why.
  //
  // Returns -1 for a duplicate request_id (409, no audit row, unchanged) or
  // the new count for this (facility, purposeCode) pair in the trailing 60
  // minutes, INCLUDING the request just recorded — request #51 within a
  // SINGLE purpose's bucket brings that bucket's count to 51 and is
  // rejected; the OTHER purpose's bucket is completely unaffected. Always
  // records regardless of purpose (duplicate detection applies to every
  // purpose that reaches this point); only Treatment/Administrative
  // ENFORCE the count as a limit — Emergency is explicitly unlimited per
  // Section 5 (still recorded here for duplicate-detection purposes, into
  // its own 'Emergency' bucket that nothing ever checks a ceiling against).
  let requestCount: number;
  try {
    const { data, error: rpcError } = await getServiceClient().rpc('increment_resolution_rate_limit', {
      p_facility_did: facility as string,
      p_request_id: requestId,
      p_purpose_code: purposeHeader as string,
    });
    if (rpcError) throw new Error(rpcError.message);
    requestCount = data as number;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'rate_limit_rpc_failed',
        resource: 'huuid_request_log',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    const auditId = await audit('internalError');
    return NextResponse.json(
      errorBody('internalError', 'Rate limit check failed.', requestId),
      { status: 500, headers: baseHeaders(auditId) }
    );
  }

  if (requestCount === -1) {
    return NextResponse.json(
      errorBody('duplicateRequest', 'X-HUUID-Request-ID has already been used.', requestId),
      { status: 409, headers: baseHeaders(null) }
    );
  }

  const RATE_LIMIT_MAX = 50;
  if ((purposeHeader === 'Treatment' || purposeHeader === 'Administrative') && requestCount > RATE_LIMIT_MAX) {
    const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
    // Retry-After must be scoped to this purpose's own bucket too — the
    // oldest row in the OTHER purpose's window is irrelevant to when THIS
    // purpose's count will drop.
    const { data: oldestInWindow } = await getServiceClient()
      .from('huuid_request_log')
      .select('logged_at')
      .eq('facility_did', facility as string)
      .eq('purpose_code', purposeHeader as string)
      .gte('logged_at', new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString())
      .order('logged_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const retryAfterSeconds = oldestInWindow
      ? Math.max(
          1,
          Math.ceil((new Date(oldestInWindow.logged_at).getTime() + RATE_LIMIT_WINDOW_MS - Date.now()) / 1000)
        )
      : 3600;

    const auditId = await audit('rateLimitExceeded');
    if (!auditId) {
      return NextResponse.json(
        errorBody('internalError', 'Audit write failed. Resolution aborted.', requestId),
        { status: 500, headers: baseHeaders(null) }
      );
    }
    return NextResponse.json(
      errorBody(
        'rateLimitExceeded',
        `Over ${RATE_LIMIT_MAX} unique resolutions/hour for ${purposeHeader}.`,
        requestId
      ),
      { status: 429, headers: { ...baseHeaders(auditId), 'Retry-After': String(retryAfterSeconds) } }
    );
  }

  // ── Step 6: resolve the DID document ──
  let record: {
    did_document: Record<string, unknown>;
    status: string;
    issuing_node: string;
    created_at: string;
    updated_at: string;
  } | null = null;

  try {
    const { data, error } = await getServiceClient()
      .from('huuid_did_documents')
      .select('did_document, status, issuing_node, created_at, updated_at')
      .eq('huuid', did)
      .maybeSingle();
    if (error) throw new Error(error.message);
    record = data;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: 'did_lookup_failed',
        resource: 'huuid_did_documents',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    const auditId = await audit('internalError');
    return NextResponse.json(
      errorBody('internalError', 'DID document lookup failed.', requestId),
      { status: 500, headers: baseHeaders(auditId) }
    );
  }

  const outcome: Outcome = !record
    ? 'notFound'
    : record.status === 'active'
      ? 'success'
      : 'deactivated';

  // ── Step 7: WRITE AUDIT BEFORE RETURNING THE RESPONSE ──
  // If the audit cannot be written, the resolution must not proceed. 500.
  const auditId = await audit(outcome);
  if (!auditId) {
    return NextResponse.json(
      errorBody(
        'internalError',
        'Audit write failed. Resolution aborted — no resolution without an audit trail.',
        requestId
      ),
      { status: 500, headers: baseHeaders(null) }
    );
  }

  // ── constant-time floor for resolution outcomes (Hours 61-80) — applied
  // uniformly before branching so 404/410/200 timings converge ──
  await enforceResponseTimeFloor(startTime);

  // ── Step 8: respond ──
  if (outcome === 'notFound') {
    return NextResponse.json(
      errorBody('notFound', 'HUUID not found in registry.', requestId),
      { status: 404, headers: baseHeaders(auditId) }
    );
  }

  if (outcome === 'deactivated') {
    return NextResponse.json(
      errorBody(
        'deactivated',
        'HUUID has been deactivated. Patient must re-enroll at the issuing node.',
        requestId
      ),
      { status: 410, headers: baseHeaders(auditId) }
    );
  }

  const now = new Date().toISOString();
  return NextResponse.json(
    {
      '@context': 'https://w3id.org/did-resolution/v1',
      didDocument: record!.did_document,
      didResolutionMetadata: {
        contentType: 'application/did+ld+json',
        resolvedAt: now,
        resolverVersion: `huuid-resolver/${RESOLVER_VERSION}`,
        durationMs: Date.now() - startTime,
      },
      didDocumentMetadata: {
        created: record!.created_at,
        updated: record!.updated_at,
        deactivated: false,
        versionId: '1',
        'huuid:issuingNode': record!.issuing_node,
        'huuid:purposeCode': purposeHeader,
        'huuid:requestingFacility': facility,
        'huuid:requestId': requestId,
        'huuid:auditEntryId': auditId,
      },
    },
    { status: 200, headers: baseHeaders(auditId) }
  );
}
