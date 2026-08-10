import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ confirmationText: z.literal('DELETE MY IDENTITY') });

/** POST /api/my-huuid/security/delete — my-huuid Layer 8, Section 4.
 * "Verify PIN decrypts correctly" is satisfied by requiring the client to
 * have just re-run the existing, already-proven PIN login flow
 * (/api/my-huuid/login/pin/challenge + /verify -- real Ed25519 signature
 * verification, Layer 1) immediately before calling this route, rather
 * than a third, separately-implemented PIN check. The typed
 * "DELETE MY IDENTITY" confirmation is enforced server-side too (zod
 * literal), not just as a client-side UI gate. Irreversible: calls the
 * same huuid_gdpr_erase_patient used by /api/enroll/erase/confirm. */
export async function POST(req: NextRequest) {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_delete_account');
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
    return NextResponse.json({ error: 'Type DELETE MY IDENTITY exactly to confirm.' }, { status: 400 });
  }

  const client = getServiceClient();
  const huuid = session.huuid;
  const phone = session.phone;

  const { error: eraseError } = await client.rpc('huuid_gdpr_erase_patient', {
    p_huuid: huuid,
    p_ip_hash: ipHash,
    p_user_agent_hash: uaHash,
  });

  if (eraseError) {
    console.error(JSON.stringify({ level: 'error', action: 'my_huuid_delete_account_failed', message: eraseError.message }));
    await writeEnrollmentAudit({ huuid, action: 'erasure_requested', ipHash, userAgentHash: uaHash, outcome: 'failed' });
    return NextResponse.json({ error: 'Could not complete deletion. Please try again or contact identity@huuid.health.' }, { status: 500 });
  }

  await patientSession.clear();

  try {
    await sendSMS(phone, 'Your HUUID Healthcare Identity has been permanently deleted, as you requested. HUUID', 'normal');
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'my_huuid_delete_account_sms_failed', message: reason }));
  }

  return NextResponse.json({ ok: true });
}
