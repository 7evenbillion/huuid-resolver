import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { medicalProfileSchema, isMedicalProfileComplete } from '@/lib/enrollment-schemas';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { patientSession } from '@/lib/patient-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { buildQrTokenPayload, signQrToken } from '@/lib/qr-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET/PATCH /api/patient/medical — scaffolding for a future /my-huuid
 * dashboard (return visits, after enrollment day). Both gated on
 * patientSession (lib/patient-session.ts, otp_type='login'), which nothing
 * currently populates: there is no /api/patient/login/start or
 * /verify-otp yet. That login pair is out of scope for this task. Until it
 * exists, both handlers below are unreachable in practice — the RPC calls
 * and validation are real and ready, not stubbed, so the future login work
 * only needs to set the cookie.
 */

interface MedicalProfileRow {
  blood_type: string | null;
  allergies: unknown;
  medications: unknown;
  chronic_conditions: unknown;
  pregnancy_status: string | null;
  organ_donor: string | null;
  implanted_devices: unknown;
  primary_physician_name: string | null;
  primary_physician_phone: string | null;
  primary_facility_name: string | null;
  primary_facility_country: string | null;
  contraindications: unknown;
  medical_profile_completed: boolean;
  medical_profile_updated_at: string | null;
}

async function requireSession() {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) return null;
  return session;
}

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const client = getServiceClient();
  const { data, error } = await client
    .rpc('huuid_get_medical_profile', { p_huuid: session.huuid, p_pii_key: getPiiKey() })
    .maybeSingle();

  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'patient_medical_get_failed', message: error.message }));
    return NextResponse.json({ error: 'Could not load your medical profile.' }, { status: 500 });
  }

  const row = data as MedicalProfileRow | null;
  if (!row) {
    return NextResponse.json({ error: 'No Healthcare Identity found for this session.' }, { status: 404 });
  }

  return NextResponse.json({
    bloodType: row.blood_type,
    allergies: row.allergies,
    medications: row.medications,
    chronicConditions: row.chronic_conditions,
    pregnancyStatus: row.pregnancy_status,
    organDonor: row.organ_donor,
    implantedDevices: row.implanted_devices,
    primaryPhysicianName: row.primary_physician_name,
    primaryPhysicianPhone: row.primary_physician_phone,
    primaryFacilityName: row.primary_facility_name,
    primaryFacilityCountry: row.primary_facility_country,
    contraindications: row.contraindications,
    medicalProfileCompleted: row.medical_profile_completed,
    medicalProfileUpdatedAt: row.medical_profile_updated_at,
  });
}

export async function PATCH(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const allowed = await checkEnrollmentRateLimit(ipHash, 'medical_profile_update');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = medicalProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid medical profile payload.' }, { status: 400 });
  }
  const input = parsed.data;

  const client = getServiceClient();
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
    p_pii_key: getPiiKey(),
  });

  if (updateError) {
    console.error(JSON.stringify({ level: 'error', action: 'patient_medical_patch_failed', message: updateError.message }));
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
