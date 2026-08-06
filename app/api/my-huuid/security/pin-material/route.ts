import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/my-huuid/security/pin-material — my-huuid Layer 8, step 1 of
 * Change PIN. Returns the current encrypted_private_key/salt/iv so the
 * client can attempt decryption with the entered current PIN locally --
 * fetched lazily only when a PIN-change attempt actually starts (not
 * proactively on page load), and rate-limited the same way a failed-PIN
 * lockout would be (3/hour per IP via the existing enrollment rate
 * limiter, rather than a new dedicated per-patient counter table). */
export async function GET(req: NextRequest) {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_pin_change_attempt');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 });
  }

  const client = getServiceClient();
  const { data, error } = await client
    .from('huuid_patients')
    .select('encrypted_private_key, pbkdf2_salt, pbkdf2_iv')
    .eq('huuid', session.huuid)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'No Healthcare Identity found for this session.' }, { status: 404 });
  }

  return NextResponse.json({
    encryptedPrivateKeyB64: data.encrypted_private_key,
    pbkdf2SaltB64: data.pbkdf2_salt,
    pbkdf2IvB64: data.pbkdf2_iv,
  });
}
