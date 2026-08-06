import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SecurityRow {
  identity_verified: boolean;
  identity_verified_method: string | null;
  identity_verified_at: string | null;
  identity_document_type: string | null;
  identity_document_country: string | null;
}

/** GET /api/my-huuid/security — my-huuid Layer 8. Plain select, no PII
 * decryption -- these are verification-metadata columns (migration 031),
 * not encrypted patient data. */
export async function GET() {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const client = getServiceClient();
  const { data, error } = await client
    .from('huuid_patients')
    .select('identity_verified, identity_verified_method, identity_verified_at, identity_document_type, identity_document_country')
    .eq('huuid', session.huuid)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'No Healthcare Identity found for this session.' }, { status: 404 });
  }

  const row = data as SecurityRow;
  return NextResponse.json({
    huuid: session.huuid,
    identityVerified: row.identity_verified,
    identityVerifiedMethod: row.identity_verified_method,
    identityVerifiedAt: row.identity_verified_at,
    identityDocumentType: row.identity_document_type,
    identityDocumentCountry: row.identity_document_country,
  });
}
