import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { generateOtp, hashOtp, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';
import { facilityOtpChallenge } from '@/lib/facility-session';
import { facilityLoginStartSchema } from '@/lib/facility-schemas-login';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'facility_login_start');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = facilityLoginStartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid Facility ID.' }, { status: 400 });
  }

  const client = getServiceClient();
  const { data: facility } = await client
    .from('huuid_facilities')
    .select('facility_did, facility_name, certificate_status, login_phone')
    .eq('facility_did', parsed.data.facilityDid)
    .single();

  // Same response whether the facility exists or not -- avoids letting a
  // caller enumerate valid facility DIDs by watching for a different error.
  const generic = NextResponse.json({ ok: true });

  if (!facility || facility.certificate_status !== 'active' || !facility.login_phone) {
    return generic;
  }

  const otp = generateOtp();
  await facilityOtpChallenge.set({
    otpHash: hashOtp(otp),
    facilityDid: facility.facility_did,
    facilityName: facility.facility_name,
    createdAt: Date.now(),
  });

  try {
    await sendSMS(
      facility.login_phone,
      `Your HUUID facility login code is: ${otp}\nValid for ${OTP_EXPIRY_MINUTES} minutes.\nDo not share this code with anyone.\nHUUID`,
      'critical'
    );
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'facility_login_start_sms_failed', message: reason }));
  }

  return generic;
}
