import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — returns facility identity for display on the credentials page,
 * gated on otp_verified so it can't be viewed without passing Step 1. */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const client = getServiceClient();
  const { data: delivery } = await client
    .from('huuid_facility_credential_deliveries')
    .select('facility_did, otp_verified, downloaded, expires_at')
    .eq('download_token', params.token)
    .single();

  if (!delivery || !delivery.otp_verified || delivery.downloaded || new Date(delivery.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Not available.' }, { status: 404 });
  }

  const { data: facility } = await client
    .from('huuid_facilities')
    .select('facility_name, certificate_status')
    .eq('facility_did', delivery.facility_did)
    .single();

  return NextResponse.json({
    facilityDid: delivery.facility_did,
    facilityName: facility?.facility_name ?? null,
    certificateStatus: facility?.certificate_status ?? null,
  });
}
