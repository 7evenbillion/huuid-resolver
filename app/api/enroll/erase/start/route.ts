import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { recoverStartSchema } from '@/lib/enrollment-schemas';
import { checkEnrollmentRateLimit, checkOtpRequestRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { eraseSession } from '@/lib/erase-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { generateOtp, hashOtp, otpMessage, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/enroll/erase/start — Step 1 of self-service erasure: phone -> OTP. Does not reveal whether the phone is enrolled either way, matching the recovery flow's behavior. */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'erasure_start');
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
  const { data: exists } = await getServiceClient().rpc('huuid_patient_exists_by_phone', { p_phone: phone, p_pii_key: piiKey });
  if (!exists) {
    await writeEnrollmentAudit({ huuid: null, action: 'erasure_requested', ipHash, userAgentHash: uaHash, outcome: 'phone_not_found' });
    return NextResponse.json({ ok: true });
  }

  const otpAllowed = await checkOtpRequestRateLimit(phone, 'erasure');
  if (!otpAllowed) {
    return NextResponse.json({ error: 'Too many code requests. Please wait before trying again.' }, { status: 429 });
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const { error: otpError } = await getServiceClient().rpc('huuid_otp_create', {
    p_phone: phone,
    p_otp_hash: hashOtp(otp),
    p_otp_type: 'erasure',
    p_ip_hash: ipHash,
    p_expires_at: expiresAt,
    p_pii_key: piiKey,
  });
  if (otpError) {
    console.error(JSON.stringify({ level: 'error', action: 'erasure_otp_create_failed', message: otpError.message }));
    return NextResponse.json({ error: 'Could not process your request. Please try again.' }, { status: 500 });
  }

  try {
    await sendSMS(phone, otpMessage(otp));
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'erasure_sms_failed', message: reason }));
    return NextResponse.json({ error: 'Could not send a verification code. Please try again.' }, { status: 502 });
  }

  await eraseSession.set({ phone, phoneVerified: false, createdAt: Date.now() });
  await writeEnrollmentAudit({ huuid: null, action: 'erasure_requested', ipHash, userAgentHash: uaHash, outcome: 'otp_sent' });

  return NextResponse.json({ ok: true, phoneLast4: phone.slice(-4) });
}
