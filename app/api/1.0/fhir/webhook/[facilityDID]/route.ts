import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { verifyFacilityJWT } from '@/lib/facility-jwt';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ACCEPTED_RESOURCE_TYPES = [
  'Encounter',
  'DiagnosticReport',
  'MedicationRequest',
  'ImagingStudy',
  'Condition',
  'Observation',
  'Procedure',
  'AllergyIntolerance',
];

function requesterIpHash(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}

function auditEntryId(requestId: string, now: Date): string {
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `audit-${ts.slice(0, 8)}-${ts.slice(8)}-${requestId.slice(0, 8)}`;
}

interface FhirSubject {
  reference?: string;
  identifier?: { value?: string };
}
interface FhirResource {
  resourceType?: string;
  id?: string;
  subject?: FhirSubject;
}

/** "Patient/12345" -> "12345"; falls back to a raw identifier.value. */
function extractLocalPatientId(subject: FhirSubject | undefined): string | null {
  if (!subject) return null;
  if (subject.reference) {
    const parts = subject.reference.split('/');
    return parts[parts.length - 1] || null;
  }
  if (subject.identifier?.value) return subject.identifier.value;
  return null;
}

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

  let resource: FhirResource;
  try {
    resource = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalidRequest', message: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!resource.resourceType || !ACCEPTED_RESOURCE_TYPES.includes(resource.resourceType)) {
    return NextResponse.json(
      { error: 'invalidRequest', message: `resourceType must be one of: ${ACCEPTED_RESOURCE_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  const localPatientId = extractLocalPatientId(resource.subject);
  if (!localPatientId) {
    return NextResponse.json(
      { error: 'invalidRequest', message: 'Could not extract a patient identifier from the resource subject field.' },
      { status: 400 }
    );
  }

  const { data: mapping } = await client
    .from('huuid_identity_map_registry')
    .select('huuid')
    .eq('facility_did', facilityDid)
    .eq('local_patient_id', localPatientId)
    .maybeSingle();

  if (!mapping) {
    return NextResponse.json(
      {
        error: 'notLinked',
        message: 'Patient not linked. Link patient first via /facility/enroll or /facility/verify',
      },
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
  const resourceId = resource.id ?? randomUUID();
  const newEndpoint = {
    id: `${huuid}#record-${facilityDid}-${resource.resourceType}-${Date.now()}`,
    type: 'HUUIDHealthRecord',
    serviceEndpoint: `did:huuid:webhook:${facilityDid}/${resourceId}`,
    facilityCode: facilityDid,
    recordType: resource.resourceType,
    recordedAt,
    consentRequired: true,
  };

  const currentDoc = (didDocRow.did_document ?? {}) as { service?: (typeof newEndpoint)[] };
  const existingService = Array.isArray(currentDoc.service) ? currentDoc.service : [];
  const filtered = existingService.filter(
    (s) => !(s.facilityCode === facilityDid && s.recordType === resource.resourceType)
  );
  const updatedDoc = { ...currentDoc, service: [...filtered, newEndpoint] };

  const { error: updateError } = await client
    .from('huuid_did_documents')
    .update({ did_document: updatedDoc, updated_at: new Date().toISOString() })
    .eq('huuid', huuid);

  if (updateError) {
    console.error(JSON.stringify({ level: 'error', action: 'fhir_webhook_did_update_failed', message: updateError.message }));
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

  return NextResponse.json({ ok: true, huuid, recordType: resource.resourceType, recordedAt }, { status: 200 });
}
