import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { sendImmediately, logSmsSend, SMSDeliveryError } from '@/lib/sms';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/sms-dispatch — normal-priority SMS queue dispatcher, invoked
 * every minute by Vercel Cron (vercel.json). See HANDOFF.md §19.4.4 and
 * lib/sms.ts for the burst-throttling diagnosis this exists to work
 * around: sending more than one SMS to the same recipient in rapid
 * succession causes Hubtel/the carrier to silently drop later messages.
 *
 * Auth is a shared secret (CRON_SECRET), not Supabase session auth --
 * Vercel Cron calls this route directly, unauthenticated by user session,
 * so the secret is the only thing preventing an outsider from draining
 * the queue or triggering sends on demand.
 */

const BATCH_SIZE = 10;
// Floor re-enforced here (in addition to the 30s gap computed once when a
// message is queued in lib/sms.ts) because two normal-priority messages
// queued for the same recipient can both become eligible in the same
// dispatcher run -- the 30s figure only accounts for the *previous*
// logged send, not a sibling being sent moments earlier in this loop.
const MIN_SEND_GAP_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// huuid_audit_enrollment.ip_hash/user_agent_hash are NOT NULL -- this run
// is a system trigger, not a live request, so there is no real IP/UA to
// hash. Same placeholder-hash convention as migration 015's
// administrative-action audit writes.
const SYSTEM_ACTOR_HASH = createHash('sha256').update('system-sms-dispatcher').digest('hex');

interface UndeliveredOtpRow {
  id: string;
  phone_hash: string;
  hubtel_message_id: string | null;
}

/** Fix 4: OTP sent (has a real Hubtel messageId) but never used within its expiry window -- visibility only, no automatic retry. */
async function flagUndeliveredOtps(client: ReturnType<typeof getServiceClient>): Promise<number> {
  const { data, error } = await client.rpc('huuid_otp_find_undelivered', { p_cutoff_minutes: 10 });
  if (error) {
    console.error(
      JSON.stringify({ level: 'error', action: 'sms_dispatch_undelivered_scan_failed', message: error.message })
    );
    return 0;
  }

  const rows = (data ?? []) as UndeliveredOtpRow[];
  for (const row of rows) {
    await writeEnrollmentAudit({
      huuid: null,
      action: 'otp_possibly_undelivered',
      ipHash: SYSTEM_ACTOR_HASH,
      userAgentHash: SYSTEM_ACTOR_HASH,
      outcome: 'unused_after_10_minutes',
      details: { phone_hash: row.phone_hash, message_id: row.hubtel_message_id },
    });
    await client.rpc('huuid_otp_flag_undelivered', { p_id: row.id });
  }
  return rows.length;
}

interface QueueRow {
  id: string;
  phone_hash: string;
  phone: string;
  message: string;
  priority: string;
  attempts: number;
}

export async function GET(req: NextRequest) {
  const providedSecret = req.headers.get('x-dispatch-secret');
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();
  const piiKey = getPiiKey();

  const { data: batch, error: claimError } = await client.rpc('huuid_sms_queue_claim_batch', {
    p_limit: BATCH_SIZE,
    p_pii_key: piiKey,
  });
  if (claimError) {
    console.error(
      JSON.stringify({ level: 'error', action: 'sms_dispatch_claim_failed', message: claimError.message })
    );
    return NextResponse.json({ error: 'Failed to claim queued messages.' }, { status: 500 });
  }

  const rows = (batch ?? []) as QueueRow[];
  let sentCount = 0;

  for (const row of rows) {
    const { data: lastSendRows } = await client
      .from('huuid_sms_send_log')
      .select('sent_at')
      .eq('phone_hash', row.phone_hash)
      .order('sent_at', { ascending: false })
      .limit(1);
    const lastSendAt = lastSendRows?.[0]?.sent_at ? new Date(lastSendRows[0].sent_at).getTime() : 0;

    if (Date.now() - lastSendAt < MIN_SEND_GAP_MS) {
      // Too soon since the last send to this recipient. Leave it queued --
      // scheduled_for is already <= now, so it stays eligible and will be
      // picked up on a later run (at most 60s away, since this route runs
      // every minute).
      continue;
    }

    try {
      const { messageId } = await sendImmediately(row.phone, row.message);
      await client.rpc('huuid_sms_queue_mark_sent', { p_id: row.id, p_hubtel_message_id: messageId });
      await logSmsSend(row.phone_hash, 'normal', messageId);
      sentCount++;
      await sleep(MIN_SEND_GAP_MS);
    } catch (err) {
      const reason =
        err instanceof SMSDeliveryError
          ? `${err.hubtelReason} / ${err.africasTalkingReason}`
          : err instanceof Error
            ? err.message
            : 'unknown';
      await client.rpc('huuid_sms_queue_increment_attempts', { p_id: row.id, p_error: reason });
      console.error(
        JSON.stringify({ level: 'error', action: 'sms_dispatch_send_failed', queueId: row.id, message: reason })
      );
    }
  }

  const undeliveredFlagged = await flagUndeliveredOtps(client);

  console.log(
    JSON.stringify({
      level: 'info',
      action: 'sms_dispatch_run',
      claimed: rows.length,
      sent: sentCount,
      undeliveredFlagged,
    })
  );

  return NextResponse.json({ ok: true, claimed: rows.length, sent: sentCount, undeliveredFlagged });
}
