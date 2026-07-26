import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { verifyOtpSchema } from '@/lib/enrollment-schemas';
import { requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { enrollmentSession } from '@/lib/enrollment-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { hashOtp, OTP_MAX_ATTEMPTS, OTP_LOCKOUT_MINUTES } from '@/lib/otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface OtpRow {
  id: string;
  otp_hash: string;
  attempts: number;
  expires_at: string;
  created_at: string;
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** POST /api/enroll/verify-otp — Screen 1b. */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const session = await enrollmentSession.get();
  if (!session) {
    return NextResponse.json({ error: 'Your enrollment session has expired. Please start again.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = verifyOtpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 });
  }

  const piiKey = getPiiKey();
  const client = getServiceClient();

  const { data: otpRowData, error: findError } = await client
    .rpc('huuid_otp_find_active', { p_phone: session.phone, p_otp_type: 'enrollment', p_pii_key: piiKey })
    .maybeSingle();
  const otpRow = otpRowData as OtpRow | null;

  if (findError) {
    console.error(JSON.stringify({ level: 'error', action: 'verify_otp_find_failed', message: findError.message }));
    return NextResponse.json({ error: 'Could not verify your code. Please try again.' }, { status: 500 });
  }

  if (!otpRow) {
    return NextResponse.json({ error: 'This code has expired. Request a new one.', code: 'expired' }, { status: 400 });
  }

  const now = Date.now();
  const expiresAt = new Date(otpRow.expires_at as string).getTime();
  const createdAt = new Date(otpRow.created_at as string).getTime();
  const attempts = otpRow.attempts as number;

  if (attempts >= OTP_MAX_ATTEMPTS) {
    const lockoutEnd = createdAt + OTP_LOCKOUT_MINUTES * 60 * 1000;
    if (now < lockoutEnd) {
      const remainingMinutes = Math.ceil((lockoutEnd - now) / 60000);
      return NextResponse.json(
        { error: `Too many attempts. Please wait ${remainingMinutes} minute(s).`, code: 'locked' },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: 'This code has expired. Request a new one.', code: 'expired' }, { status: 400 });
  }

  if (now > expiresAt) {
    return NextResponse.json({ error: 'This code has expired. Request a new one.', code: 'expired' }, { status: 400 });
  }

  const enteredHash = hashOtp(parsed.data.code);
  if (!safeEqualHex(enteredHash, otpRow.otp_hash as string)) {
    const { data: newAttempts } = await client.rpc('huuid_otp_increment_attempts', { p_id: otpRow.id });
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - (newAttempts ?? attempts + 1));
    return NextResponse.json(
      { error: `Incorrect code. ${remaining} attempt(s) remaining.`, code: 'incorrect', attemptsRemaining: remaining },
      { status: 400 }
    );
  }

  await client.rpc('huuid_otp_mark_used', { p_id: otpRow.id });
  await enrollmentSession.update({ phoneVerified: true });
  await writeEnrollmentAudit({ huuid: null, action: 'phone_verified', ipHash, userAgentHash: uaHash, outcome: 'success' });

  return NextResponse.json({ ok: true });
}
