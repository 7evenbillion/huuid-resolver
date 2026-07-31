import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashOtp } from '@/lib/otp';
import { adminOtpChallenge, adminSession } from '@/lib/admin-session';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const verifySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits.') });

export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'admin_login_verify');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Code must be 6 digits.' }, { status: 400 });
  }

  const challenge = await adminOtpChallenge.get();
  if (!challenge) {
    return NextResponse.json({ error: 'Login session expired. Please request a new code.' }, { status: 401 });
  }

  if (hashOtp(parsed.data.code) !== challenge.otpHash) {
    return NextResponse.json({ error: 'Incorrect code.' }, { status: 401 });
  }

  await adminSession.set({ phone: challenge.phone, createdAt: Date.now() });
  await adminOtpChallenge.clear();

  return NextResponse.json({ ok: true });
}
