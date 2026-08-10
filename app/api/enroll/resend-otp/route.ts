import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { requesterIpHash } from '@/lib/enrollment-rate-limit';
import { checkOtpRequestRateLimit } from '@/lib/enrollment-rate-limit';
import { enrollmentSession } from '@/lib/enrollment-session';
import { generateOtp, hashOtp, otpMessage, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/enroll/resend-otp — the "Resend Code" link on Screen 1b. Max 3 resends is enforced by the same 3-per-hour OTP request limit as the initial send. */
export async function POST(req: NextRequest) {
  const session = await enrollmentSession.get();
  if (!session) {
    return NextResponse.json({ error: 'Your enrollment session has expired. Please start again.' }, { status: 400 });
  }

  const allowed = await checkOtpRequestRateLimit(session.phone, 'enrollment');
  if (!allowed) {
    return NextResponse.json({ error: 'Maximum resends reached. Please wait before trying again.' }, { status: 429 });
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const { data: otpIdRows, error: otpError } = await getServiceClient().rpc('huuid_otp_create', {
    p_phone: session.phone,
    p_otp_hash: hashOtp(otp),
    p_otp_type: 'enrollment',
    p_ip_hash: requesterIpHash(req),
    p_expires_at: expiresAt,
    p_pii_key: getPiiKey(),
  });
  if (otpError) {
    console.error(JSON.stringify({ level: 'error', action: 'resend_otp_create_failed', message: otpError.message }));
    return NextResponse.json({ error: 'Could not resend a code. Please try again.' }, { status: 500 });
  }
  const otpId = Array.isArray(otpIdRows) ? otpIdRows[0] : otpIdRows;

  try {
    const smsResult = await sendSMS(session.phone, otpMessage(otp), 'critical');
    if (!smsResult.queued && otpId) {
      await getServiceClient().rpc('huuid_otp_set_message_id', { p_id: otpId, p_hubtel_message_id: smsResult.messageId });
    }
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'resend_otp_sms_failed', message: reason }));
    return NextResponse.json({ error: 'Could not send a verification code. Please try again.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
