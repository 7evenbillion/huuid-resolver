import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SecurityRow {
  verification_tier: number;
  identity_verified: boolean;
  identity_verified_method: string | null;
  identity_verified_at: string | null;
  identity_document_type: string | null;
  identity_document_country: string | null;
  identity_verified_facility_name: string | null;
}

/** GET /api/my-huuid/security — my-huuid Layer 8, extended in dedup
 * Layer 7 with verification_tier and the verifying facility's name
 * (huuid_get_identity_status, migration 045) so the settings page can
 * tell a Tier 1 document-verified patient apart from a Tier 2
 * facility-verified one. No PII decryption needed -- these are
 * verification-metadata columns, not encrypted patient data. */
export async function GET() {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const client = getServiceClient();
  const { data, error } = await client
    .rpc('huuid_get_identity_status', { p_huuid: session.huuid })
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'No Healthcare Identity found for this session.' }, { status: 404 });
  }

  const row = data as SecurityRow;
  return NextResponse.json({
    huuid: session.huuid,
    verificationTier: row.verification_tier,
    identityVerified: row.identity_verified,
    identityVerifiedMethod: row.identity_verified_method,
    identityVerifiedAt: row.identity_verified_at,
    identityDocumentType: row.identity_document_type,
    identityDocumentCountry: row.identity_document_country,
    identityVerifiedFacilityName: row.identity_verified_facility_name,
  });
}
