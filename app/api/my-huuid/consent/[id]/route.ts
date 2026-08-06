import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ decision: z.enum(['granted', 'declined']) });

/** PATCH /api/my-huuid/consent/[id] — my-huuid Layer 7. `id` is the
 * consent_id string (e.g. CONSENT-...), not the row's uuid primary key --
 * that's what every other consent route in this codebase (facility side)
 * already keys on. Ownership is checked (huuid must match the session)
 * before any write; huuid_consent_requests' own trigger (migration 020)
 * independently blocks a second write once status is granted/declined,
 * so a decision can't be reversed even if this check were bypassed. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_consent_decision');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid decision.' }, { status: 400 });
  }

  const client = getServiceClient();

  const { data: existing, error: fetchError } = await client
    .from('huuid_consent_requests')
    .select('huuid, status, expires_at')
    .eq('consent_id', params.id)
    .maybeSingle();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Consent request not found.' }, { status: 404 });
  }
  if (existing.huuid !== session.huuid) {
    return NextResponse.json({ error: 'Consent request not found.' }, { status: 404 });
  }
  if (existing.status !== 'pending') {
    return NextResponse.json({ error: 'This request has already been responded to.' }, { status: 409 });
  }
  if (new Date(existing.expires_at) <= new Date()) {
    return NextResponse.json({ error: 'This request has expired.' }, { status: 409 });
  }

  const { error: updateError } = await client
    .from('huuid_consent_requests')
    .update({ status: parsed.data.decision, response_received_at: new Date().toISOString() })
    .eq('consent_id', params.id);

  if (updateError) {
    console.error(JSON.stringify({ level: 'error', action: 'my_huuid_consent_decision_failed', message: updateError.message }));
    return NextResponse.json({ error: 'Could not record your decision. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: parsed.data.decision });
}
