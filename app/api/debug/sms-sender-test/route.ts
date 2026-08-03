import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * TEMPORARY, standalone diagnostic endpoint. Does not touch lib/sms.ts or
 * any application code — sends "Hello 123" via each of several sender IDs
 * directly against smsc.hubtel.com (same host/GET/query-string shape as
 * lib/sms.ts, for an apples-to-apples comparison), to the same fixed
 * number, and reports HTTP status + messageId + Hubtel's own delivery
 * status for each. Remove after diagnosis is done.
 */
const TARGET = '+233243222058';
const SENDER_IDS = ['BEDWATCHAFR', 'HUUID', 'INFO', 'TEST'];

interface SendResult {
  senderId: string;
  sendHttpStatus: number;
  sendBody: unknown;
  statusCheckHttpStatus: number | null;
  statusCheckBody: unknown;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST() {
  const clientId = process.env.HUBTEL_CLIENT_ID;
  const clientSecret = process.env.HUBTEL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Hubtel credentials not configured.' }, { status: 500 });
  }

  const results: SendResult[] = [];

  for (const senderId of SENDER_IDS) {
    const url = new URL('https://smsc.hubtel.com/v1/messages/send');
    url.searchParams.set('clientid', clientId);
    url.searchParams.set('clientsecret', clientSecret);
    url.searchParams.set('from', senderId);
    url.searchParams.set('to', TARGET);
    url.searchParams.set('content', 'Hello 123');

    let sendHttpStatus = 0;
    let sendBody: unknown = null;
    let messageId: string | null = null;

    try {
      const res = await fetch(url.toString(), { cache: 'no-store' });
      sendHttpStatus = res.status;
      const text = await res.text();
      try {
        sendBody = JSON.parse(text);
        messageId = (sendBody as { messageId?: string })?.messageId ?? null;
      } catch {
        sendBody = text;
      }
    } catch (err) {
      sendBody = { error: err instanceof Error ? err.message : 'fetch failed' };
    }

    let statusCheckHttpStatus: number | null = null;
    let statusCheckBody: unknown = null;

    if (messageId) {
      await sleep(4000);
      try {
        const auth = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const statusRes = await fetch(`https://smsc.hubtel.com/v1/messages/${messageId}`, {
          headers: { Authorization: auth },
          cache: 'no-store',
        });
        statusCheckHttpStatus = statusRes.status;
        const statusText = await statusRes.text();
        try {
          statusCheckBody = JSON.parse(statusText);
        } catch {
          statusCheckBody = statusText;
        }
      } catch (err) {
        statusCheckBody = { error: err instanceof Error ? err.message : 'status check failed' };
      }
    }

    results.push({ senderId, sendHttpStatus, sendBody, statusCheckHttpStatus, statusCheckBody });
  }

  return NextResponse.json({ target: TARGET, results });
}
