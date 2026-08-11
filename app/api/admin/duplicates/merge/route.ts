import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminSession } from '@/lib/admin-session';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SYSTEM_ACTOR_HASH = createHash('sha256').update('root-authority-admin-action').digest('hex');

/** POST /api/admin/duplicates/merge — "CONFIRMED DUPLICATE — MERGE": same person, keeps the older HUUID, revokes the newer one. */
export async function POST(req: NextRequest) {
  const session = await adminSession.get();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const huuidA = typeof body?.huuidA === 'string' ? body.huuidA : null;
  const huuidB = typeof body?.huuidB === 'string' ? body.huuidB : null;
  if (!huuidA || !huuidB) return NextResponse.json({ error: 'Missing huuids.' }, { status: 400 });

  const client = getServiceClient();
  const piiKey = getPiiKey();

  // Phone numbers must be captured BEFORE the merge -- huuid_get_patient_
  // profile only returns active patients, and one side of this pair is
  // about to be revoked.
  const [{ data: profileARows }, { data: profileBRows }] = await Promise.all([
    client.rpc('huuid_get_patient_profile', { p_huuid: huuidA, p_pii_key: piiKey }),
    client.rpc('huuid_get_patient_profile', { p_huuid: huuidB, p_pii_key: piiKey }),
  ]);
  const profileA = (Array.isArray(profileARows) ? profileARows[0] : profileARows) as { phone: string } | undefined;
  const profileB = (Array.isArray(profileBRows) ? profileBRows[0] : profileBRows) as { phone: string } | undefined;

  const { data: mergeRows, error } = await client.rpc('huuid_merge_duplicates', {
    p_huuid_a: huuidA,
    p_huuid_b: huuidB,
  });
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'admin_duplicate_merge_failed', message: error.message }));
    return NextResponse.json({ error: 'Could not merge these identities.' }, { status: 500 });
  }
  const result = (Array.isArray(mergeRows) ? mergeRows[0] : mergeRows) as
    | { older_huuid: string; newer_huuid: string }
    | undefined;
  if (!result) {
    return NextResponse.json({ error: 'Merge did not complete.' }, { status: 500 });
  }

  await writeEnrollmentAudit({
    huuid: result.older_huuid,
    action: 'potential_duplicate_flagged',
    ipHash: SYSTEM_ACTOR_HASH,
    userAgentHash: SYSTEM_ACTOR_HASH,
    outcome: 'merged_kept',
    details: { revoked_huuid: result.newer_huuid },
  });
  await writeEnrollmentAudit({
    huuid: result.newer_huuid,
    action: 'potential_duplicate_flagged',
    ipHash: SYSTEM_ACTOR_HASH,
    userAgentHash: SYSTEM_ACTOR_HASH,
    outcome: 'merged_revoked',
    details: { kept_huuid: result.older_huuid },
  });

  const notifyPhone = result.newer_huuid === huuidA ? profileA?.phone : profileB?.phone;
  if (notifyPhone) {
    try {
      await sendSMS(
        notifyPhone,
        `Your duplicate Healthcare Identity has been merged. Your active HUUID is: ${result.older_huuid}. HUUID`,
        'normal'
      );
    } catch (err) {
      const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
      console.error(JSON.stringify({ level: 'warn', action: 'admin_duplicate_merge_sms_failed', message: reason }));
    }
  }

  return NextResponse.json({ ok: true, olderHuuid: result.older_huuid, newerHuuid: result.newer_huuid });
}
