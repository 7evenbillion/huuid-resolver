import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase-server';
import { facilitySession } from '@/lib/facility-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  huuid: z.string().min(1),
  method: z.enum(['patient_presented_card', 'retrospective_link', 'facility_enrollment']),
  localPatientId: z.string().trim().max(200).optional().nullable(),
});

/** Shared identity-linking endpoint (Layer 7) — used both after enrolling
 * a new patient at this facility and after verifying an existing patient
 * who wants their visit linked. No local patient ID is stored here
 * (huuid_identity_map_registry deliberately holds none — see migration
 * 020's own comment); this only records that the link exists. */
export async function POST(req: NextRequest) {
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
  const { error } = await client.from('huuid_identity_map_registry').upsert(
    {
      huuid: parsed.data.huuid,
      facility_did: session.facilityDid,
      linked_by: session.facilityDid,
      link_method: parsed.data.method,
      local_patient_id: parsed.data.localPatientId ?? null,
    },
    { onConflict: 'huuid,facility_did', ignoreDuplicates: true }
  );
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'facility_link_failed', message: error.message }));
    return NextResponse.json({ error: 'Could not link this patient.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
