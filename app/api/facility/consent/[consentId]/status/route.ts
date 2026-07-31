import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { facilitySession } from '@/lib/facility-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { consentId: string } }) {
  const session = await facilitySession.get();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const client = getServiceClient();
  const { data: consent } = await client
    .from('huuid_consent_requests')
    .select('status, expires_at, requesting_facility_did')
    .eq('consent_id', params.consentId)
    .single();

  if (!consent || consent.requesting_facility_did !== session.facilityDid) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  let status = consent.status;
  if (status === 'pending' && new Date(consent.expires_at).getTime() < Date.now()) {
    await client
      .from('huuid_consent_requests')
      .update({ status: 'expired' })
      .eq('consent_id', params.consentId)
      .eq('status', 'pending');
    status = 'expired';
  }

  return NextResponse.json({ status, expiresAt: consent.expires_at });
}
