import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { recoverStartSchema } from '@/lib/enrollment-schemas';
import { checkEnrollmentRateLimit, checkOtpRequestRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';
import { myHuuidOtpLoginSession } from '@/lib/my-huuid-login-session';
import { generateOtp, hashOtp, otpMessage, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RecoveryLookupRow {
  huuid: string;
  status: string;
}

/**
 * POST /api/my-huuid/login/otp/start — Method B (phone) of my-huuid
 * Layer 1. Built fully and reachable now; actual SMS delivery is
 * currently blocked account-side on Hubtel (see docs/HANDOFF.md §19.4.1)
 * -- the UI shows a "pending" banner near this action, this route itself
 * is not stubbed.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_otp_login_start');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts from this network. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = recoverStartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 });
  }
  const { phone } = parsed.data;
  const piiKey = getPiiKey();
  const client = getServiceClient();

  const { data: rows } = await client.rpc('huuid_get_patient_for_recovery', { p_phone: phone, p_pii_key: piiKey });
  const row = (Array.isArray(rows) ? rows[0] : rows) as RecoveryLookupRow | undefined;

  // Same response whether the phone is enrolled or not -- no enumeration.
  const generic = NextResponse.json({ ok: true });
  if (!row || row.status !== 'active') {
    return generic;
  }

  const otpAllowed = await checkOtpRequestRateLimit(phone, 'login');
  if (!otpAllowed) {
    return NextResponse.json({ error: 'Too many code requests. Please wait before trying again.' }, { status: 429 });
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const { data: otpIdRows, error: otpError } = await client.rpc('huuid_otp_create', {
    p_phone: phone,
    p_otp_hash: hashOtp(otp),
    p_otp_type: 'login',
    p_ip_hash: ipHash,
    p_expires_at: expiresAt,
    p_pii_key: piiKey,
  });
  if (otpError) {
    console.error(JSON.stringify({ level: 'error', action: 'my_huuid_otp_login_create_failed', message: otpError.message }));
    return NextResponse.json({ error: 'Could not process your request. Please try again.' }, { status: 500 });
  }
  const otpId = Array.isArray(otpIdRows) ? otpIdRows[0] : otpIdRows;

  try {
    const smsResult = await sendSMS(phone, otpMessage(otp), 'critical');
    if (!smsResult.queued && otpId) {
      await client.rpc('huuid_otp_set_message_id', { p_id: otpId, p_hubtel_message_id: smsResult.messageId });
    }
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'my_huuid_otp_login_sms_failed', message: reason }));
    // Do not fail the request over SMS delivery -- known-broken account-side
    // (docs/HANDOFF.md §19.4.1). The session is still set so the flow is
    // fully testable once delivery is restored.
  }

  await myHuuidOtpLoginSession.set({ phone, huuid: row.huuid, phoneVerified: false, createdAt: Date.now() });

  return NextResponse.json({ ok: true, phoneLast4: phone.slice(-4) });
}
