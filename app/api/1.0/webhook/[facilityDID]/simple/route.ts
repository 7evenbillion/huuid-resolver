import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { verifyFacilityJWT } from '@/lib/facility-jwt';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  localPatientId: z.string().min(1),
  recordType: z.string().min(1),
  recordLocation: z.string().url(),
  recordDate: z.string().min(1),
});

function requesterIpHash(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}

function auditEntryId(requestId: string, now: Date): string {
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `audit-${ts.slice(0, 8)}-${ts.slice(8)}-${requestId.slice(0, 8)}`;
}

/**
 * POST /1.0/webhook/{facilityDID}/simple — the non-FHIR path, for
 * facilities whose "patient records system" (per the onboarding form) is
 * paper-based or a custom system with no FHIR capability. Same auth and
 * DID Document update as the FHIR route, simplified request/response
 * shape only.
 */
export async function POST(req: NextRequest, { params }: { params: { facilityDID: string } }) {
  const start = Date.now();
  const facilityDid = decodeURIComponent(params.facilityDID ?? '');
  const requestId = req.headers.get('x-huuid-request-id') || randomUUID();
  const ipHash = requesterIpHash(req);

  const client = getServiceClient();

  const { data: facilityRow } = await client
    .from('huuid_facilities')
    .select('public_key_multibase, certificate_status')
    .eq('facility_did', facilityDid)
    .maybeSingle();

  if (!facilityRow) {
    return NextResponse.json({ error: 'unauthorized', message: 'Unknown facility.' }, { status: 401 });
  }
  if (facilityRow.certificate_status !== 'active') {
    return NextResponse.json({ error: 'forbidden', message: 'Facility certificate is not active.' }, { status: 403 });
  }

  const jwtResult = await verifyFacilityJWT(req.headers.get('authorization'), facilityRow.public_key_multibase);
  if (!jwtResult.ok) {
    return NextResponse.json({ error: 'unauthorized', message: jwtResult.reason }, { status: 401 });
  }
  if (jwtResult.claims.sub !== facilityDid) {
    return NextResponse.json({ error: 'unauthorized', message: 'JWT subject does not match the facility in the URL.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalidRequest', message: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalidRequest', message: 'localPatientId, recordType, recordLocation (URL), and recordDate are required.' },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const { data: mapping } = await client
    .from('huuid_identity_map_registry')
    .select('huuid')
    .eq('facility_did', facilityDid)
    .eq('local_patient_id', input.localPatientId)
    .maybeSingle();

  if (!mapping) {
    return NextResponse.json(
      { error: 'notLinked', message: 'Patient not linked. Link patient first via /facility/enroll or /facility/verify' },
      { status: 404 }
    );
  }

  const huuid = mapping.huuid;
  const { data: didDocRow } = await client
    .from('huuid_did_documents')
    .select('did_document')
    .eq('huuid', huuid)
    .single();

  if (!didDocRow) {
    return NextResponse.json({ error: 'notFound', message: 'HUUID has no DID Document on record.' }, { status: 404 });
  }

  const recordedAt = new Date().toISOString();
  const newEndpoint = {
    id: `${huuid}#record-${facilityDid}-${input.recordType}-${Date.now()}`,
    type: 'HUUIDHealthRecord',
    serviceEndpoint: input.recordLocation,
    facilityCode: facilityDid,
    recordType: input.recordType,
    recordedAt,
    consentRequired: true,
  };

  const currentDoc = (didDocRow.did_document ?? {}) as { service?: (typeof newEndpoint)[] };
  const existingService = Array.isArray(currentDoc.service) ? currentDoc.service : [];
  const filtered = existingService.filter(
    (s) => !(s.facilityCode === facilityDid && s.recordType === input.recordType)
  );
  const updatedDoc = { ...currentDoc, service: [...filtered, newEndpoint] };

  const { error: updateError } = await client
    .from('huuid_did_documents')
    .update({ did_document: updatedDoc, updated_at: new Date().toISOString() })
    .eq('huuid', huuid);

  if (updateError) {
    console.error(JSON.stringify({ level: 'error', action: 'simple_webhook_did_update_failed', message: updateError.message }));
    return NextResponse.json({ error: 'internalError', message: 'Could not update DID Document.' }, { status: 500 });
  }

  const entryId = auditEntryId(requestId, new Date());
  await client.from('huuid_audit_log').insert({
    audit_entry_id: entryId,
    request_id: requestId,
    huuid,
    requesting_facility: facilityDid,
    purpose_code: 'Administrative',
    outcome: 'success',
    break_glass: false,
    response_time_ms: Date.now() - start,
    ip_hash: ipHash,
    resolver_version: RESOLVER_VERSION,
  });

  return NextResponse.json({ ok: true, huuid, recordType: input.recordType, recordedAt }, { status: 200 });
}
