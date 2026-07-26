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

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  // Host confirmed against Hubtel's own official SDK (github.com/hubtel/hubtel-sms-java,
  // ApiHost.java's default hostname) -- "api.hubtel.com" (the original spec's host)
  // returns "Provided ClientId could not be found" for a real, correctly-formatted
  // account, which is what "smsc.hubtel.com" is the actual live SMS host.
  const res = await fetch('https://smsc.hubtel.com/v1/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ From: senderId, To: phone, Content: message }),
    cache: 'no-store',
  });

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

  // A 2xx HTTP status does NOT mean the message was actually queued/sent --
  // Hubtel's own response carries a separate domain-level status field
  // (0 == "request submitted successfully" per their docs). A non-zero
  // status, a null messageId, or a null networkId with an HTTP 200 all
  // indicate the message was accepted by the endpoint but not genuinely
  // dispatched (e.g. insufficient account balance) -- this was silently
  // treated as success before this fix.
  console.log(
    JSON.stringify({
      level: 'info',
      action: 'sms_hubtel_response',
      status: data.status,
      statusDescription: data.statusDescription,
      rate: data.rate,
      networkId: data.networkId,
      hasMessageId: Boolean(data.messageId),
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
