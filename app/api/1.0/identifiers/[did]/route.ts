import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { verifyFacilityJWT } from '@/lib/facility-jwt';

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
 * - Research purpose is blocked (403) until Root Authority approval.
 *   Root Authority (current): HUUID Protocol Working Group. Upon successful
 *   pilot adoption, operational control transitions to the national health
 *   authority of the adopting country. See api.md § Governance and
 *   docs/CORRECTIONS.md.
 * - AUDIT WRITE BEFORE RESPONSE — if the audit write fails, the resolution
 *   fails with 500 and no DID document is returned. No exceptions.
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
  let jwtFailureReason: string | null = null;
  try {
    const { data: facilityRow, error: facilityLookupError } = await getServiceClient()
      .from('huuid_facilities')
      .select('public_key_multibase')
      .eq('facility_did', facility as string)
      .maybeSingle();

    if (facilityLookupError) throw new Error(facilityLookupError.message);

    if (!facilityRow) {
      jwtFailureReason = 'Unknown facility. Facility DID is not registered.';
    } else {
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

  // ── Step 3: Research purpose is blocked until Root Authority approval ──
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

  // ── Step 4: resolve the DID document ──
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

  // ── Step 5: WRITE AUDIT BEFORE RETURNING THE RESPONSE ──
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

  // ── Step 6: respond ──
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
