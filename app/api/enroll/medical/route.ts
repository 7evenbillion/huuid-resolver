import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { medicalProfileSchema, isMedicalProfileComplete } from '@/lib/enrollment-schemas';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { postEnrollmentSession } from '@/lib/post-enrollment-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { buildQrTokenPayload, signQrToken } from '@/lib/qr-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/enroll/medical — Phase 2A. Reachable only within
 * postEnrollmentSession's 30-minute window right after /api/enroll/register
 * succeeds (see lib/post-enrollment-session.ts for why this exists instead
 * of re-verifying OTP). The huuid is read from that session, never from the
 * request body, so a client cannot write medical data for a huuid it did
 * not just create in this browser.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'medical_profile_update');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const session = await postEnrollmentSession.get();
  if (!session) {
    return NextResponse.json(
      { error: 'Your enrollment session has expired. You can add this information later from your Healthcare Identity card.' },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = medicalProfileSchema.safeParse(body);
  if (!parsed.success) {
    await writeEnrollmentAudit({ huuid: session.huuid, action: 'medical_profile_updated', ipHash, userAgentHash: uaHash, outcome: 'invalid_payload' });
    return NextResponse.json({ error: 'Invalid medical profile payload.' }, { status: 400 });
  }
  const input = parsed.data;

  const client = getServiceClient();
  const piiKey = getPiiKey();

  const { error: updateError } = await client.rpc('huuid_update_medical_profile', {
    p_huuid: session.huuid,
    p_blood_type: input.bloodType ?? null,
    p_allergies: input.allergies ?? [],
    p_medications: input.medications ?? [],
    p_chronic_conditions: input.chronicConditions ?? [],
    p_pregnancy_status: input.pregnancyStatus ?? null,
    p_organ_donor: input.organDonor ?? null,
    p_implanted_devices: input.implantedDevices ?? [],
    p_primary_physician_name: input.primaryPhysicianName ?? null,
    p_primary_physician_phone: input.primaryPhysicianPhone ?? null,
    p_primary_facility_name: input.primaryFacilityName ?? null,
    p_primary_facility_country: input.primaryFacilityCountry ?? null,
    p_contraindications: input.contraindications ?? [],
    p_pii_key: piiKey,
  });

  if (updateError) {
    console.error(JSON.stringify({ level: 'error', action: 'medical_profile_update_failed', message: updateError.message }));
    await writeEnrollmentAudit({ huuid: session.huuid, action: 'medical_profile_updated', ipHash, userAgentHash: uaHash, outcome: 'failed' });
    return NextResponse.json({ error: 'Could not save your medical profile. Please try again.' }, { status: 500 });
  }

  await writeEnrollmentAudit({ huuid: session.huuid, action: 'medical_profile_updated', ipHash, userAgentHash: uaHash, outcome: 'success' });

  const payload = buildQrTokenPayload(session.huuid, {
    bloodType: input.bloodType,
    allergies: input.allergies,
    medications: input.medications,
    chronicConditions: input.chronicConditions,
    organDonor: input.organDonor,
    implantedDevices: input.implantedDevices,
    pregnancyStatus: input.pregnancyStatus,
    primaryFacilityName: input.primaryFacilityName,
    contraindications: input.contraindications,
  });
  const signed = signQrToken(payload);

  return NextResponse.json({
    ok: true,
    medicalProfileCompleted: isMedicalProfileComplete(input),
    qrToken: signed?.token ?? null,
    qrTokenUsingInterimKey: signed?.usingInterimKey ?? null,
  });
}
