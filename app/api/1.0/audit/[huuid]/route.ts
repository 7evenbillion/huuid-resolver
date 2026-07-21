import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { verifyFacilityJWT } from '@/lib/facility-jwt';
import { ROOT_AUTHORITY_FACILITY_DID } from '@/lib/root-authority';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /1.0/audit/{huuid} — audit log access (HUUID-RESOLVER-API-v0.2 Section
 * 1.1 / 6.2, Month 5). Scoped facility JWT required, same verification as
 * standard resolution (Authorization: Bearer {JWT}, verified against
 * huuid_facilities.public_key_multibase, sub must match X-HUUID-Facility).
 *
 * Access rule, per spec's "who sees what" table: a facility sees only its
 * own records for this HUUID. The Root Authority (HUUID Protocol Working
 * Group, josephtdnarnor@gmail.com) is identified by its own facility DID,
 * did:huuid:gh:root-authority-hpwg, seeded in huuid_facilities like any
 * other facility so its JWT verifies the same way — no special-cased
 * signature path, only a special-cased QUERY SCOPE once identity is
 * established. When that DID is the requester, no facility filter is
 * applied: it sees every record for this HUUID across all facilities.
 * ROOT_AUTHORITY_FACILITY_DID now lives in lib/root-authority.ts (Month 6)
 * so /api/health's own elevated view uses the identical constant.
 *
 * Not rate-limited and not duplicate-request-id-checked — this is a read of
 * one's own audit trail, not a resolution event, and neither constraint is
 * named anywhere in the spec for this endpoint. Adding either would be
 * inventing a requirement, not honoring one.
 */

const MAX_RECORDS = 50;

function errorBody(error: string, errorMessage: string) {
  return { error, errorMessage };
}

export async function GET(req: NextRequest, { params }: { params: { huuid: string } }) {
  const huuid = decodeURIComponent(params.huuid ?? '');
  const facility = req.headers.get('x-huuid-facility');

  if (!facility) {
    return NextResponse.json(errorBody('invalidRequest', 'Missing required header: X-HUUID-Facility'), {
      status: 400,
    });
  }
  if (!huuid.startsWith('did:huuid:')) {
    return NextResponse.json(
      errorBody('invalidRequest', 'Malformed HUUID. Expected format: did:huuid:{country}:{identifier}'),
      { status: 400 }
    );
  }

  let facilityPublicKey: string | null = null;
  try {
    const { data, error } = await getServiceClient()
      .from('huuid_facilities')
      .select('public_key_multibase')
      .eq('facility_did', facility)
      .maybeSingle();
    if (error) throw new Error(error.message);
    facilityPublicKey = data?.public_key_multibase ?? null;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        action: 'audit_facility_lookup_failed',
        resource: 'huuid_facilities',
        status: 500,
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    return NextResponse.json(errorBody('internalError', 'Facility lookup failed.'), { status: 500 });
  }

  if (!facilityPublicKey) {
    return NextResponse.json(
      errorBody('unauthorized', 'Unknown facility. Facility DID is not registered.'),
      { status: 401 }
    );
  }

  const jwtResult = await verifyFacilityJWT(req.headers.get('authorization'), facilityPublicKey);
  if (!jwtResult.ok) {
    return NextResponse.json(errorBody('unauthorized', jwtResult.reason), { status: 401 });
  }
  if (jwtResult.claims.sub !== facility) {
    return NextResponse.json(
      errorBody('unauthorized', 'JWT subject (sub) does not match X-HUUID-Facility header.'),
      { status: 401 }
    );
  }

  const isRootAuthority = facility === ROOT_AUTHORITY_FACILITY_DID;

  let query = getServiceClient()
    .from('huuid_audit_log')
    .select(
      'audit_entry_id, request_id, requesting_facility, purpose_code, outcome, break_glass, resolved_at, response_time_ms'
    )
    .eq('huuid', huuid)
    .order('resolved_at', { ascending: false })
    .limit(MAX_RECORDS);

  if (!isRootAuthority) {
    query = query.eq('requesting_facility', facility);
  }

  const { data: rows, error: queryError } = await query;
  if (queryError) {
    console.error(
      JSON.stringify({
        level: 'error',
        action: 'audit_query_failed',
        resource: 'huuid_audit_log',
        status: 500,
        message: queryError.message,
        timestamp: new Date().toISOString(),
      })
    );
    return NextResponse.json(errorBody('internalError', 'Audit query failed.'), { status: 500 });
  }

  return NextResponse.json(
    {
      huuid,
      scope: isRootAuthority ? 'all_facilities' : 'own_facility_only',
      recordCount: rows?.length ?? 0,
      records: (rows ?? []).map((r) => ({
        auditEntryId: r.audit_entry_id,
        requestId: r.request_id,
        requestingFacility: r.requesting_facility,
        purposeCode: r.purpose_code,
        outcome: r.outcome,
        breakGlass: r.break_glass,
        resolvedAt: r.resolved_at,
        responseTimeMs: r.response_time_ms,
      })),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
