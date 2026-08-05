import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { patientProfileUpdateSchema } from '@/lib/enrollment-schemas';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { patientSession } from '@/lib/patient-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ProfileRow {
  full_name: string;
  date_of_birth: string;
  sex_at_birth: string;
  country_code: string;
  phone: string;
  phone_verified: boolean;
  email: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

async function requireSession() {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) return null;
  return session;
}

/** GET/PATCH /api/my-huuid/profile — my-huuid Layer 3. Phone and country
 * are returned (read-only) but never accepted on PATCH -- see migration
 * 030's header comment for why those two fields are out of scope here. */
export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const client = getServiceClient();
  const { data, error } = await client
    .rpc('huuid_get_patient_profile', { p_huuid: session.huuid, p_pii_key: getPiiKey() })
    .maybeSingle();

  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'my_huuid_profile_get_failed', message: error.message }));
    return NextResponse.json({ error: 'Could not load your profile.' }, { status: 500 });
  }

  const row = data as ProfileRow | null;
  if (!row) {
    return NextResponse.json({ error: 'No Healthcare Identity found for this session.' }, { status: 404 });
  }

  return NextResponse.json({
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    sexAtBirth: row.sex_at_birth,
    countryCode: row.country_code,
    phone: row.phone,
    phoneVerified: row.phone_verified,
    email: row.email,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function PATCH(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_profile_update');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = patientProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid profile data.', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const client = getServiceClient();
  const { error: updateError } = await client.rpc('huuid_update_patient_profile', {
    p_huuid: session.huuid,
    p_full_name: input.fullName,
    p_date_of_birth: input.dateOfBirth,
    p_sex_at_birth: input.sexAtBirth,
    p_emergency_contact_name: input.emergencyContactName ?? null,
    p_emergency_contact_phone: input.emergencyContactPhone ?? null,
    p_email: input.email ?? null,
    p_pii_key: getPiiKey(),
  });

  if (updateError) {
    console.error(JSON.stringify({ level: 'error', action: 'my_huuid_profile_patch_failed', message: updateError.message }));
    await writeEnrollmentAudit({ huuid: session.huuid, action: 'profile_updated', ipHash, userAgentHash: uaHash, outcome: 'failed' });
    return NextResponse.json({ error: 'Could not save your profile. Please try again.' }, { status: 500 });
  }

  await writeEnrollmentAudit({ huuid: session.huuid, action: 'profile_updated', ipHash, userAgentHash: uaHash, outcome: 'success' });

  return NextResponse.json({ ok: true });
}
