import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { facilitySession } from '@/lib/facility-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/facility/tier2-upgrade/staff-verified — Layer 5, no-Smile-ID
 * path. Staff visually confirmed the patient's government ID matches the
 * name/DOB shown on screen; no face-match biometric involved. This is
 * the only Tier 2 path currently reachable in this environment (Smile
 * ID isn't configured, and even once it is, a patient who skipped Layer
 * 3's enrollment verification has no enrolled Smile ID face to compare
 * against at the facility either way).
 */
export async function POST(req: NextRequest) {
  const session = await facilitySession.get();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const huuid = typeof (body as { huuid?: unknown })?.huuid === 'string' ? (body as { huuid: string }).huuid : null;
  if (!huuid) {
    return NextResponse.json({ error: 'Missing huuid.' }, { status: 400 });
  }

  const client = getServiceClient();

  const { error: upgradeError } = await client.rpc('huuid_complete_tier2_upgrade', { p_huuid: huuid });
  if (upgradeError) {
    console.error(
      JSON.stringify({ level: 'error', action: 'tier2_staff_verified_upgrade_failed', message: upgradeError.message })
    );
    return NextResponse.json({ error: 'Could not upgrade this patient.' }, { status: 500 });
  }

  const ipHash = createHash('sha256').update(req.headers.get('x-forwarded-for') ?? 'unknown').digest('hex');
  const uaHash = createHash('sha256').update(req.headers.get('user-agent') ?? 'unknown').digest('hex');

  await writeEnrollmentAudit({
    huuid,
    action: 'tier2_upgrade_staff_verified',
    ipHash,
    userAgentHash: uaHash,
    outcome: 'success',
    details: { verifying_facility_did: session.facilityDid },
  });
  await writeEnrollmentAudit({
    huuid,
    action: 'tier2_upgrade_completed',
    ipHash,
    userAgentHash: uaHash,
    outcome: 'staff_document_check',
  });

  const { data: profileRows } = await client.rpc('huuid_get_patient_profile', { p_huuid: huuid, p_pii_key: getPiiKey() });
  const profile = (Array.isArray(profileRows) ? profileRows[0] : profileRows) as { phone: string } | undefined;
  if (profile?.phone) {
    try {
      await sendSMS(
        profile.phone,
        `HUUID IDENTITY VERIFIED\n\nYour Healthcare Identity has been verified in person at ${session.facilityName}.\n\nYour HUUID is now Tier 2 -- Facility Verified. You now have full access to the HUUID network.\n\nHUUID`,
        'normal'
      );
    } catch (err) {
      const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
      console.error(JSON.stringify({ level: 'warn', action: 'tier2_staff_verified_sms_failed', message: reason }));
    }
  }

  return NextResponse.json({ ok: true });
}
