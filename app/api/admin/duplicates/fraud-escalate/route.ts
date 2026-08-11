import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminSession } from '@/lib/admin-session';
import { getServiceClient } from '@/lib/supabase-server';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SYSTEM_ACTOR_HASH = createHash('sha256').update('root-authority-admin-action').digest('hex');

/** POST /api/admin/duplicates/fraud-escalate — "FRAUD SUSPECTED": suspends the newer HUUID immediately, pending deeper investigation. */
export async function POST(req: NextRequest) {
  const session = await adminSession.get();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const huuid = typeof body?.huuid === 'string' ? body.huuid : null;
  if (!huuid) return NextResponse.json({ error: 'Missing huuid.' }, { status: 400 });

  const client = getServiceClient();
  const { error } = await client.rpc('huuid_flag_fraud_suspected', { p_huuid: huuid });
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'admin_duplicate_fraud_escalate_failed', message: error.message }));
    return NextResponse.json({ error: 'Could not suspend this identity.' }, { status: 500 });
  }

  await writeEnrollmentAudit({
    huuid,
    action: 'potential_duplicate_flagged',
    ipHash: SYSTEM_ACTOR_HASH,
    userAgentHash: SYSTEM_ACTOR_HASH,
    outcome: 'fraud_suspected_suspended',
  });

  const rootPhone = process.env.HUUID_ROOT_AUTHORITY_PHONE;
  if (rootPhone) {
    try {
      await sendSMS(
        rootPhone,
        `FRAUD SUSPECTED\nHUUID ${huuid} has been suspended pending investigation.\nHUUID`,
        'normal'
      );
    } catch (err) {
      const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
      console.error(JSON.stringify({ level: 'warn', action: 'admin_duplicate_fraud_sms_failed', message: reason }));
    }
  }

  return NextResponse.json({ ok: true });
}
