import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST/GET /api/webhooks/hubtel/inbound-sms — receives a patient's YES/NO
 * reply to a consent-request SMS (Layer 6's "REQUEST RECORD ACCESS" flow).
 *
 * NOT VERIFIED AGAINST A REAL HUBTEL PAYLOAD. This project's own
 * HANDOFF.md (huuid-resolver docs/HANDOFF.md §18.8) documents three real
 * outbound-SMS bugs that only surfaced by testing against Hubtel for
 * real, not by reading docs -- the same caution applies here in reverse.
 * No live inbound webhook has ever been registered or received in this
 * project, so the exact field names Hubtel sends for an inbound message
 * are unconfirmed. This handler defensively checks several plausible
 * field-name variants (From/from/sender/msisdn/mobile,
 * Content/content/text/message/body) across both query params and a
 * JSON or form-encoded body, on both GET and POST, to maximize the
 * chance of matching whatever Hubtel actually sends -- but this MUST be
 * confirmed with a real registered webhook and a real test reply before
 * being relied on. The operator needs to register this route's full URL
 * (https://<domain>/api/webhooks/hubtel/inbound-sms) in the Hubtel
 * dashboard as the inbound/receive callback for the sender ID in use;
 * that registration cannot be done from code.
 */

function firstDefined(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (v) return v;
  }
  return null;
}

async function extractFields(req: NextRequest): Promise<{ from: string | null; content: string | null }> {
  const url = new URL(req.url);
  const q = url.searchParams;

  let bodyFrom: string | null = null;
  let bodyContent: string | null = null;

  if (req.method === 'POST') {
    const contentType = req.headers.get('content-type') || '';
    try {
      if (contentType.includes('application/json')) {
        const json = (await req.json()) as Record<string, unknown>;
        bodyFrom = firstDefined(
          typeof json.From === 'string' ? json.From : null,
          typeof json.from === 'string' ? json.from : null,
          typeof json.Sender === 'string' ? json.Sender : null,
          typeof json.mobile === 'string' ? json.mobile : null,
          typeof json.msisdn === 'string' ? json.msisdn : null
        );
        bodyContent = firstDefined(
          typeof json.Content === 'string' ? json.Content : null,
          typeof json.content === 'string' ? json.content : null,
          typeof json.Text === 'string' ? json.Text : null,
          typeof json.text === 'string' ? json.text : null,
          typeof json.message === 'string' ? json.message : null,
          typeof json.body === 'string' ? json.body : null
        );
      } else {
        const form = await req.formData();
        bodyFrom = firstDefined(
          form.get('From')?.toString(),
          form.get('from')?.toString(),
          form.get('mobile')?.toString(),
          form.get('msisdn')?.toString()
        );
        bodyContent = firstDefined(
          form.get('Content')?.toString(),
          form.get('content')?.toString(),
          form.get('Text')?.toString(),
          form.get('text')?.toString()
        );
      }
    } catch {
      // fall through to query params
    }
  }

  const from = firstDefined(
    bodyFrom,
    q.get('From'),
    q.get('from'),
    q.get('mobile'),
    q.get('msisdn')
  );
  const content = firstDefined(
    bodyContent,
    q.get('Content'),
    q.get('content'),
    q.get('Text'),
    q.get('text')
  );

  return { from, content };
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('233')) return `+${trimmed}`;
  if (trimmed.startsWith('0')) return `+233${trimmed.slice(1)}`;
  return `+${trimmed}`;
}

async function handle(req: NextRequest) {
  const { from, content } = await extractFields(req);
  if (!from || !content) {
    console.warn(JSON.stringify({ level: 'warn', action: 'hubtel_inbound_sms_unparseable', hasFrom: !!from, hasContent: !!content }));
    return NextResponse.json({ ok: true });
  }

  const reply = content.trim().toUpperCase();
  const decision = reply === 'YES' ? 'granted' : reply === 'NO' ? 'declined' : null;
  if (!decision) {
    return NextResponse.json({ ok: true });
  }

  const client = getServiceClient();
  const piiKey = getPiiKey();
  const phone = normalizePhone(from);

  const { data: hashRows } = await client.rpc('huuid_hash_phone', { p_phone: phone, p_pii_key: piiKey });
  const phoneHash = Array.isArray(hashRows) ? hashRows[0] : hashRows;
  if (!phoneHash) {
    return NextResponse.json({ ok: true });
  }

  const { data: pending } = await client
    .from('huuid_consent_requests')
    .select('consent_id, expires_at')
    .eq('patient_phone_hash', phoneHash)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pending || new Date(pending.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ ok: true });
  }

  await client
    .from('huuid_consent_requests')
    .update({ status: decision, response_received_at: new Date().toISOString() })
    .eq('consent_id', pending.consent_id)
    .eq('status', 'pending');

  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
