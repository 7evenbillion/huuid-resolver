import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { enrollmentStartSchema } from '@/lib/enrollment-schemas';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { enrollmentSession } from '@/lib/enrollment-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { generateOtp, hashOtp, otpMessage, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/enroll/start — Screen 1 submission. Validates the enrollment
 * form, rate-limits by IP, rejects an already-enrolled phone, issues an
 * OTP, and stashes the form data server-side (httpOnly encrypted cookie,
 * never localStorage/URL params) pending phone verification. All PII from
 * this point on flows from the session, never from later request bodies.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'enrollment_start');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many enrollment attempts from this network. Please try again later.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = enrollmentStartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid form data.', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const piiKey = getPiiKey();
  const { data: alreadyEnrolled, error: existsError } = await getServiceClient().rpc(
    'huuid_patient_exists_by_phone',
    { p_phone: input.phone, p_pii_key: piiKey }
  );
  if (existsError) {
    console.error(JSON.stringify({ level: 'error', action: 'enroll_start_exists_check_failed', message: existsError.message }));
    return NextResponse.json({ error: 'Could not process your request. Please try again.' }, { status: 500 });
  }
  if (alreadyEnrolled) {
    return NextResponse.json(
      { error: 'This phone number is already enrolled. Try recovering your identity instead.' },
      { status: 409 }
    );
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const { data: otpIdRows, error: otpError } = await getServiceClient().rpc('huuid_otp_create', {
    p_phone: input.phone,
    p_otp_hash: hashOtp(otp),
    p_otp_type: 'enrollment',
    p_ip_hash: ipHash,
    p_expires_at: expiresAt,
    p_pii_key: piiKey,
  });
  if (otpError) {
    console.error(JSON.stringify({ level: 'error', action: 'enroll_start_otp_create_failed', message: otpError.message }));
    return NextResponse.json({ error: 'Could not process your request. Please try again.' }, { status: 500 });
  }
  const otpId = Array.isArray(otpIdRows) ? otpIdRows[0] : otpIdRows;

  try {
    const smsResult = await sendSMS(input.phone, otpMessage(otp), 'critical');
    if (!smsResult.queued && otpId) {
      await getServiceClient().rpc('huuid_otp_set_message_id', { p_id: otpId, p_hubtel_message_id: smsResult.messageId });
    }
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'enroll_start_sms_failed', message: reason }));
    await writeEnrollmentAudit({ huuid: null, action: 'enrollment_started', ipHash, userAgentHash: uaHash, outcome: 'sms_failed' });
    return NextResponse.json(
      { error: 'Could not send a verification code to that number. Please check it and try again.' },
      { status: 502 }
    );
  }

  await enrollmentSession.set({
    fullName: input.fullName,
    dateOfBirth: input.dateOfBirth,
    sexAtBirth: input.sexAtBirth,
    countryCode: input.countryCode,
    phone: input.phone,
    email: input.email ?? null,
    emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactPhone: input.emergencyContactPhone ?? null,
    consentIpHash: ipHash,
    phoneVerified: false,
    createdAt: Date.now(),
  });

  await writeEnrollmentAudit({ huuid: null, action: 'enrollment_started', ipHash, userAgentHash: uaHash, outcome: 'success' });

  return NextResponse.json({ ok: true, phoneLast4: input.phone.slice(-4) });
}
