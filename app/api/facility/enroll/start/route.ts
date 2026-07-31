import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { enrollmentStartSchema } from '@/lib/enrollment-schemas';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { enrollmentSession } from '@/lib/enrollment-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { generateOtp, hashOtp, otpMessage, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';
import { facilitySession } from '@/lib/facility-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/facility/enroll/start (Layer 7) — a staff member enrolling a
 * patient at a facility terminal. Reuses the exact same session/OTP/keygen
 * pipeline as self-enrollment (/enroll) from this point forward — the
 * patient still verifies their own phone and still sets their own PIN on
 * this device (client-side Ed25519 keygen, private key never touches the
 * server) — the only difference is the OTP goes out with facility-witnessed
 * wording and the session remembers which facility to link at the end.
 */
export async function POST(req: NextRequest) {
  const facility = await facilitySession.get();
  if (!facility) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'facility_enroll_start');
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
    console.error(JSON.stringify({ level: 'error', action: 'facility_enroll_start_exists_check_failed', message: existsError.message }));
    return NextResponse.json({ error: 'Could not process this enrollment. Please try again.' }, { status: 500 });
  }
  if (alreadyEnrolled) {
    return NextResponse.json(
      { error: 'This phone number is already enrolled. Use Verify a Patient instead.' },
      { status: 409 }
    );
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const { error: otpError } = await getServiceClient().rpc('huuid_otp_create', {
    p_phone: input.phone,
    p_otp_hash: hashOtp(otp),
    p_otp_type: 'enrollment',
    p_ip_hash: ipHash,
    p_expires_at: expiresAt,
    p_pii_key: piiKey,
  });
  if (otpError) {
    console.error(JSON.stringify({ level: 'error', action: 'facility_enroll_start_otp_create_failed', message: otpError.message }));
    return NextResponse.json({ error: 'Could not process this enrollment. Please try again.' }, { status: 500 });
  }

  const message = `${facility.facilityName} is enrolling you in the HUUID Healthcare Identity network.\n\n${otpMessage(otp)}`;
  try {
    await sendSMS(input.phone, message);
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'facility_enroll_start_sms_failed', message: reason }));
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
    witnessingFacilityDid: facility.facilityDid,
    createdAt: Date.now(),
  });

  await writeEnrollmentAudit({ huuid: null, action: 'enrollment_started', ipHash, userAgentHash: uaHash, outcome: 'success' });

  return NextResponse.json({ ok: true, phoneLast4: input.phone.slice(-4) });
}
