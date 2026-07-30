import { NextRequest, NextResponse } from 'next/server';
import { generateOtp, hashOtp, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';
import { adminOtpChallenge } from '@/lib/admin-session';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/login/start — no request body. There is exactly one
 * admin phone (HUUID_ROOT_AUTHORITY_PHONE), so unlike patient OTP flows
 * there is nothing for a caller to supply or enumerate.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'admin_login_start');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429 });
  }

  const phone = process.env.HUUID_ROOT_AUTHORITY_PHONE;
  if (!phone) {
    console.error(JSON.stringify({ level: 'error', action: 'admin_login_start_no_phone_configured' }));
    return NextResponse.json({ error: 'Admin login is not configured yet.' }, { status: 503 });
  }

  const otp = generateOtp();
  await adminOtpChallenge.set({ otpHash: hashOtp(otp), phone, createdAt: Date.now() });

  try {
    await sendSMS(
      phone,
      `Your HUUID Root Authority login code is: ${otp}\nValid for ${OTP_EXPIRY_MINUTES} minutes.\nDo not share this code with anyone.\nHUUID`
    );
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'admin_login_start_sms_failed', message: reason }));
    return NextResponse.json({ error: 'Could not send a login code. Please try again.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, phoneLast4: phone.slice(-4) });
}
