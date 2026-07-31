import { NextRequest, NextResponse } from 'next/server';
import { hashOtp } from '@/lib/otp';
import { facilityOtpChallenge, facilitySession } from '@/lib/facility-session';
import { facilityLoginVerifySchema } from '@/lib/facility-schemas-login';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'facility_login_verify');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = facilityLoginVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Code must be 6 digits.' }, { status: 400 });
  }

  const challenge = await facilityOtpChallenge.get();
  if (!challenge) {
    return NextResponse.json({ error: 'Login session expired. Please request a new code.' }, { status: 401 });
  }
  if (hashOtp(parsed.data.code) !== challenge.otpHash) {
    return NextResponse.json({ error: 'Incorrect code.' }, { status: 401 });
  }

  await facilitySession.set({
    facilityDid: challenge.facilityDid,
    facilityName: challenge.facilityName,
    createdAt: Date.now(),
  });
  await facilityOtpChallenge.clear();

  return NextResponse.json({ ok: true });
}
