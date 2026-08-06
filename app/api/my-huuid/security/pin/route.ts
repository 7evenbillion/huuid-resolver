import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  encryptedPrivateKeyB64: z.string().min(1),
  pbkdf2SaltB64: z.string().min(1),
  pbkdf2IvB64: z.string().min(1),
});

/** PATCH /api/my-huuid/security/pin — my-huuid Layer 8, step 2 of Change
 * PIN. The client has already decrypted the private key with the current
 * PIN and re-encrypted it with the new one (lib/client/keypair.ts's
 * reencryptPrivateKeyWithNewPin) -- this route only ever sees the new
 * ciphertext, never either PIN or the raw key. A successful decrypt on
 * the client is itself the proof the current PIN was correct; there is
 * nothing further to verify server-side. */
export async function POST(req: NextRequest) {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_pin_change_commit');
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
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const client = getServiceClient();
  const { error: updateError } = await client
    .from('huuid_patients')
    .update({
      encrypted_private_key: parsed.data.encryptedPrivateKeyB64,
      pbkdf2_salt: parsed.data.pbkdf2SaltB64,
      pbkdf2_iv: parsed.data.pbkdf2IvB64,
    })
    .eq('huuid', session.huuid);

  if (updateError) {
    console.error(JSON.stringify({ level: 'error', action: 'my_huuid_pin_change_failed', message: updateError.message }));
    await writeEnrollmentAudit({ huuid: session.huuid, action: 'pin_changed', ipHash, userAgentHash: uaHash, outcome: 'failed' });
    return NextResponse.json({ error: 'Could not update your PIN. Please try again.' }, { status: 500 });
  }

  await writeEnrollmentAudit({ huuid: session.huuid, action: 'pin_changed', ipHash, userAgentHash: uaHash, outcome: 'success' });

  try {
    await sendSMS(session.phone, 'Your HUUID security PIN was just changed. If this was not you, contact identity@huuid.health immediately. HUUID');
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'my_huuid_pin_change_sms_failed', message: reason }));
  }

  return NextResponse.json({ ok: true });
}
