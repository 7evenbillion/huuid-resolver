import 'server-only';
import { getServiceClient } from './supabase-server';
import { getPiiKey } from './pii';

/**
 * SMS delivery — Hubtel primary, Africa's Talking fallback (CLAUDE.md
 * §02/§19: Hubtel is the Ghana-primary channel, Africa's Talking is the
 * SMS-only fallback for non-Ghana Africa, never the reverse). The caller
 * never learns which provider delivered the message — only success or a
 * thrown error after both have failed. Provider-specific details are
 * logged server-side only, never surfaced to the client.
 *
 * Burst-throttling fix (HANDOFF.md §19.4.4, migrations 032-034): messages
 * sent in rapid machine-speed succession to the same recipient are silently
 * dropped by Hubtel/the carrier despite a status:0 accept response. OTP
 * sends are patient-safety-critical and time-sensitive, so they still go
 * out synchronously. Every other notification is queued and dispatched by
 * a separate cron-triggered route (app/api/sms-dispatch) with real spacing
 * instead.
 */

export type SMSPriority = 'critical' | 'normal';

export interface SMSResult {
  success: true;
  queued: false;
  provider: 'hubtel' | 'africastalking';
  messageId: string;
}

export interface SMSQueuedResult {
  success: true;
  queued: true;
  queueId: string;
  scheduledFor: string;
}

export class SMSDeliveryError extends Error {
  constructor(
    public readonly hubtelReason: string,
    public readonly africasTalkingReason: string
  ) {
    super('SMS delivery failed on both providers.');
    this.name = 'SMSDeliveryError';
  }
}

// Minimum gap enforced between two normal-priority sends queued back to
// back for the same recipient. The dispatcher enforces a further 5s floor
// again at actual send time (see app/api/sms-dispatch/route.ts) -- this
// value only affects how far in the future a newly queued message starts
// out scheduled for.
const MIN_QUEUE_GAP_MS = 30_000;

async function sendViaHubtel(phone: string, message: string): Promise<{ messageId: string }> {
  const clientId = process.env.HUBTEL_CLIENT_ID;
  const clientSecret = process.env.HUBTEL_CLIENT_SECRET;
  const senderId = process.env.HUBTEL_SENDER_ID;
  if (!clientId || !clientSecret || !senderId) {
    throw new Error('Hubtel credentials are not configured.');
  }

  // GET with query-string params (clientid/clientsecret/from/to/content) --
  // NOT POST+JSON+BasicAuth. Confirmed against a sibling Cedimaker project
  // (cedimaker-legacy-ui/lib/sms.ts) that sends real, confirmed-delivered
  // SMS today with this exact same Hubtel account. The POST+JSON+BasicAuth
  // shape (matching the original build spec, and Hubtel's own Java SDK
  // structure) returns HTTP 200 with status:0 and a real messageId+charge
  // -- Hubtel accepts and bills the request -- but apparently does not
  // read To/Content from a JSON body on this endpoint, so nothing actually
  // reaches a real handset. This was hard to diagnose because the failure
  // is silent: no error, a real charge, a real messageId, just no delivery.
  const url = new URL('https://smsc.hubtel.com/v1/messages/send');
  url.searchParams.set('clientid', clientId);
  url.searchParams.set('clientsecret', clientSecret);
  url.searchParams.set('from', senderId);
  url.searchParams.set('to', phone);
  url.searchParams.set('content', message);

  const res = await fetch(url.toString(), { cache: 'no-store' });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Hubtel returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as {
    messageId?: string | null;
    status?: number;
    statusDescription?: string;
    rate?: number;
    networkId?: string | null;
  };

  console.log(
    JSON.stringify({
      level: 'info',
      action: 'sms_hubtel_response',
      status: data.status,
      statusDescription: data.statusDescription,
      rate: data.rate,
      networkId: data.networkId,
      hasMessageId: Boolean(data.messageId),
      // messageId itself (not just its presence) -- needed to look up real
      // delivery status via GET https://smsc.hubtel.com/v1/messages/{id}
      // after the fact. Not PII/secret, just Hubtel's own tracking id.
      messageId: data.messageId ?? null,
    })
  );

  if (data.status !== 0 || !data.messageId) {
    throw new Error(
      `Hubtel accepted the request but did not confirm delivery: status=${data.status} "${data.statusDescription}" rate=${data.rate} networkId=${data.networkId}`
    );
  }

  return { messageId: data.messageId };
}

async function sendViaAfricasTalking(phone: string, message: string): Promise<{ messageId: string }> {
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const username = process.env.AFRICASTALKING_USERNAME;
  if (!apiKey || !username) {
    throw new Error("Africa's Talking credentials are not configured.");
  }

  const body = new URLSearchParams({
    username,
    to: phone,
    message,
    from: 'HUUID',
  });

  const res = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Africa's Talking returned ${res.status}: ${bodyText.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as {
    SMSMessageData?: { Recipients?: { messageId?: string; status?: string }[] };
  };
  const recipient = data.SMSMessageData?.Recipients?.[0];
  if (recipient && recipient.status && !recipient.status.toLowerCase().includes('success')) {
    throw new Error(`Africa's Talking recipient status: ${recipient.status}`);
  }
  return { messageId: recipient?.messageId ?? `at-${Date.now()}` };
}

/** Actual synchronous send, Hubtel first then Africa's Talking fallback. Used for critical sends and by the dispatcher for queued normal sends. */
export async function sendImmediately(
  phone: string,
  message: string
): Promise<{ provider: 'hubtel' | 'africastalking'; messageId: string }> {
  try {
    const { messageId } = await sendViaHubtel(phone, message);
    return { provider: 'hubtel', messageId };
  } catch (hubtelErr) {
    const hubtelReason = hubtelErr instanceof Error ? hubtelErr.message : 'Unknown Hubtel failure';
    console.error(JSON.stringify({ level: 'warn', action: 'sms_hubtel_failed', message: hubtelReason }));

    try {
      const { messageId } = await sendViaAfricasTalking(phone, message);
      return { provider: 'africastalking', messageId };
    } catch (atErr) {
      const atReason = atErr instanceof Error ? atErr.message : "Unknown Africa's Talking failure";
      console.error(JSON.stringify({ level: 'error', action: 'sms_africastalking_failed', message: atReason }));
      throw new SMSDeliveryError(hubtelReason, atReason);
    }
  }
}

async function hashPhone(phone: string): Promise<string> {
  const { data, error } = await getServiceClient().rpc('huuid_hash_phone', {
    p_phone: phone,
    p_pii_key: getPiiKey(),
  });
  if (error) throw new Error(`Failed to hash phone for SMS: ${error.message}`);
  const hash = Array.isArray(data) ? data[0] : data;
  if (!hash) throw new Error('huuid_hash_phone returned no hash');
  return hash as string;
}

/** Records a real send (critical immediate, or a queued normal send once the dispatcher actually delivers it) so the next lookup for this phone_hash sees it. */
export async function logSmsSend(
  phoneHash: string,
  priority: SMSPriority,
  hubtelMessageId: string | null
): Promise<void> {
  const { error } = await getServiceClient()
    .from('huuid_sms_send_log')
    .insert({ phone_hash: phoneHash, priority, hubtel_message_id: hubtelMessageId });
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'sms_send_log_insert_failed', message: error.message }));
  }
}

/**
 * CRITICAL priority (OTP only): sends immediately via Hubtel/Africa's
 * Talking, logs the send, never touches the queue.
 *
 * NORMAL priority (every other notification): never sent from here.
 * Computes scheduled_for as 30s after now or 30s after this recipient's
 * last logged send, whichever is later, inserts into huuid_sms_queue, and
 * returns immediately. The actual send happens later via the
 * /api/sms-dispatch cron route.
 */
export async function sendSMS(
  phone: string,
  message: string,
  priority: SMSPriority = 'normal'
): Promise<SMSResult | SMSQueuedResult> {
  const phoneHash = await hashPhone(phone);

  if (priority === 'critical') {
    const { provider, messageId } = await sendImmediately(phone, message);
    await logSmsSend(phoneHash, 'critical', messageId);
    return { success: true, queued: false, provider, messageId };
  }

  const client = getServiceClient();

  const { data: lastSendRows, error: lastSendError } = await client
    .from('huuid_sms_send_log')
    .select('sent_at')
    .eq('phone_hash', phoneHash)
    .order('sent_at', { ascending: false })
    .limit(1);
  if (lastSendError) {
    throw new Error(`Failed to check last SMS send time: ${lastSendError.message}`);
  }

  const lastSendAt = lastSendRows?.[0]?.sent_at ? new Date(lastSendRows[0].sent_at).getTime() : 0;
  const now = Date.now();
  const scheduledFor = new Date(Math.max(now + MIN_QUEUE_GAP_MS, lastSendAt + MIN_QUEUE_GAP_MS)).toISOString();

  const { data: queueIdRows, error: queueError } = await client.rpc('huuid_sms_queue_insert', {
    p_phone_hash: phoneHash,
    p_phone: phone,
    p_message: message,
    p_priority: 'normal',
    p_scheduled_for: scheduledFor,
    p_pii_key: getPiiKey(),
  });
  if (queueError) {
    throw new Error(`Failed to queue SMS: ${queueError.message}`);
  }
  const queueId = Array.isArray(queueIdRows) ? queueIdRows[0] : queueIdRows;

  console.log(
    JSON.stringify({ level: 'info', action: 'sms_queued', priority: 'normal', scheduledFor, queueId })
  );

  return { success: true, queued: true, queueId, scheduledFor };
}
