import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { eraseSession } from '@/lib/erase-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PatientLookup {
  huuid: string;
  status: string;
}

/**
 * POST /api/enroll/erase/confirm — only reachable after phone OTP
 * verification (Step 2). Irreversible: calls huuid_gdpr_erase_patient,
 * which nulls all recoverable PII and revokes both huuid_patients and
 * huuid_did_documents. phone_hash is deliberately retained (operator
 * decision, migration 017) -- the erased number cannot re-enroll a new
 * HUUID afterward without contacting identity@huuid.health.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const session = await eraseSession.get();
  if (!session || !session.phoneVerified) {
    return NextResponse.json({ error: 'Phone number is not verified.' }, { status: 401 });
  }

  const client = getServiceClient();
  const piiKey = getPiiKey();

  const { data: lookupData, error: lookupError } = await client
    .rpc('huuid_get_patient_huuid_by_phone', { p_phone: session.phone, p_pii_key: piiKey })
    .maybeSingle();
  const lookup = lookupData as PatientLookup | null;

  if (lookupError || !lookup) {
    return NextResponse.json({ error: 'No enrolled identity found for this phone number.' }, { status: 404 });
  }

  if (lookup.status !== 'active') {
    return NextResponse.json({ error: 'This Healthcare Identity is not active.' }, { status: 409 });
  }

  const { error: eraseError } = await client.rpc('huuid_gdpr_erase_patient', {
    p_huuid: lookup.huuid,
    p_ip_hash: ipHash,
    p_user_agent_hash: uaHash,
  });

  if (eraseError) {
    console.error(JSON.stringify({ level: 'error', action: 'erasure_confirm_failed', message: eraseError.message }));
    await writeEnrollmentAudit({ huuid: lookup.huuid, action: 'erasure_requested', ipHash, userAgentHash: uaHash, outcome: 'failed' });
    return NextResponse.json({ error: 'Could not complete erasure. Please try again or contact identity@huuid.health.' }, { status: 500 });
  }

  await eraseSession.clear();

  return NextResponse.json({ ok: true, huuid: lookup.huuid });
}
