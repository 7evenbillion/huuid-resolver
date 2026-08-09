import 'server-only';

/**
 * SMS delivery — Hubtel primary, Africa's Talking fallback (CLAUDE.md
 * §02/§19: Hubtel is the Ghana-primary channel, Africa's Talking is the
 * SMS-only fallback for non-Ghana Africa, never the reverse). The caller
 * never learns which provider delivered the message — only success or a
 * thrown error after both have failed. Provider-specific details are
 * logged server-side only, never surfaced to the client.
 */

export interface SMSResult {
  success: true;
  provider: 'hubtel' | 'africastalking';
  messageId: string;
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

export async function sendSMS(phone: string, message: string): Promise<SMSResult> {
  try {
    const { messageId } = await sendViaHubtel(phone, message);
    return { success: true, provider: 'hubtel', messageId };
  } catch (hubtelErr) {
    const hubtelReason = hubtelErr instanceof Error ? hubtelErr.message : 'Unknown Hubtel failure';
    console.error(JSON.stringify({ level: 'warn', action: 'sms_hubtel_failed', message: hubtelReason }));

    try {
      const { messageId } = await sendViaAfricasTalking(phone, message);
      return { success: true, provider: 'africastalking', messageId };
    } catch (atErr) {
      const atReason = atErr instanceof Error ? atErr.message : "Unknown Africa's Talking failure";
      console.error(JSON.stringify({ level: 'error', action: 'sms_africastalking_failed', message: atReason }));
      throw new SMSDeliveryError(hubtelReason, atReason);
    }
  }
}
