import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { facilitySession } from '@/lib/facility-session';
import { getPiiKey } from '@/lib/pii';
import { extractHuuidFromScannedValue } from '@/lib/qr-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.union([
  z.object({ mode: z.literal('huuid'), huuid: z.string().min(1) }),
  z.object({ mode: z.literal('qr'), raw: z.string().min(1) }),
  z.object({
    mode: z.literal('search'),
    name: z.string().trim().min(1).max(200),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  }),
]);

function requesterIpHash(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}

function auditEntryId(requestId: string, now: Date): string {
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `audit-${ts.slice(0, 8)}-${ts.slice(8)}-${requestId.slice(0, 8)}`;
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const session = await facilitySession.get();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const client = getServiceClient();
  const piiKey = getPiiKey();

  // Tab 3 (name + DOB search) returns candidates for staff to pick from --
  // it does not itself resolve or write an audit entry, since no specific
  // patient has been selected yet.
  if (parsed.data.mode === 'search') {
    const { data: candidates, error } = await client.rpc('huuid_search_patients_by_name_dob', {
      p_name_query: parsed.data.name,
      p_dob: parsed.data.dateOfBirth ?? null,
      p_pii_key: piiKey,
    });
    if (error) {
      console.error(JSON.stringify({ level: 'error', action: 'facility_verify_search_failed', message: error.message }));
      return NextResponse.json({ error: 'Search failed.' }, { status: 500 });
    }
    return NextResponse.json({ candidates: candidates ?? [] });
  }

  let huuid: string | null = null;
  if (parsed.data.mode === 'huuid') {
    huuid = parsed.data.huuid.trim();
  } else {
    huuid = extractHuuidFromScannedValue(parsed.data.raw);
  }

  if (!huuid) {
    return NextResponse.json({ error: 'Could not read a HUUID from that input.' }, { status: 400 });
  }

  const requestId = randomUUID();
  const ipHash = requesterIpHash(req);

  const { data: didDoc } = await client
    .from('huuid_did_documents')
    .select('status, did_document')
    .eq('did', huuid)
    .single();

  async function writeAudit(outcome: string) {
    const entryId = auditEntryId(requestId, new Date());
    await client.from('huuid_audit_log').insert({
      audit_entry_id: entryId,
      request_id: requestId,
      huuid,
      requesting_facility: session!.facilityDid,
      purpose_code: 'Treatment',
      outcome,
      break_glass: false,
      response_time_ms: Date.now() - start,
      ip_hash: ipHash,
      resolver_version: RESOLVER_VERSION,
    });
  }

  if (!didDoc) {
    await writeAudit('notFound');
    return NextResponse.json({ error: 'notFound', message: 'No HUUID found matching that identifier.' }, { status: 404 });
  }
  if (didDoc.status !== 'active') {
    await writeAudit('deactivated');
    return NextResponse.json({ error: 'deactivated', message: 'This HUUID has been deactivated.' }, { status: 410 });
  }

  const [{ data: patientRows }, { data: medicalRows }] = await Promise.all([
    client.rpc('huuid_get_patient_by_huuid', { p_huuid: huuid, p_pii_key: piiKey }),
    client.rpc('huuid_get_medical_profile', { p_huuid: huuid, p_pii_key: piiKey }),
  ]);
  const patient = Array.isArray(patientRows) ? patientRows[0] : patientRows;
  const medical = Array.isArray(medicalRows) ? medicalRows[0] : medicalRows;

  const serviceEndpoints: { facilityCode?: string }[] =
    (didDoc.did_document as { service?: { facilityCode?: string }[] })?.service ?? [];
  const holdingFacilityNames = Array.from(
    new Set(serviceEndpoints.map((s) => s.facilityCode).filter(Boolean))
  ) as string[];

  await writeAudit('success');

  return NextResponse.json({
    huuid,
    fullName: patient?.full_name ?? null,
    bloodType: medical?.blood_type ?? null,
    allergies: medical?.allergies ?? [],
    medications: medical?.medications ?? [],
    chronicConditions: medical?.chronic_conditions ?? [],
    contraindications: medical?.contraindications ?? [],
    organDonor: medical?.organ_donor ?? null,
    pregnancyStatus: medical?.pregnancy_status ?? null,
    medicalProfileCompleted: medical?.medical_profile_completed ?? false,
    holdingFacilityNames,
  });
}
