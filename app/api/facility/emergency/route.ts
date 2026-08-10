import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { facilitySession } from '@/lib/facility-session';
import { getServiceClient } from '@/lib/supabase-server';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ issue: z.string().trim().min(1).max(1000) });

/** GET — the Root Authority phone to display on the modal ("Or call
 * directly:"). Only reachable by an authenticated facility session, same
 * gate as everything else under /facility. */
export async function GET() {
  const session = await facilitySession.get();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  return NextResponse.json({ rootAuthorityPhone: process.env.HUUID_ROOT_AUTHORITY_PHONE ?? null });
}

export async function POST(req: NextRequest) {
  const session = await facilitySession.get();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'facility_emergency');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many alerts sent. Please call the Root Authority directly.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please describe the issue.' }, { status: 400 });
  }

  const rootAuthorityPhone = process.env.HUUID_ROOT_AUTHORITY_PHONE;
  if (!rootAuthorityPhone) {
    return NextResponse.json(
      { error: 'Emergency alerting is not configured yet. Please contact the HUUID Root Authority directly.' },
      { status: 503 }
    );
  }

  const client = getServiceClient();
  const { data: facility } = await client
    .from('huuid_facilities')
    .select('login_phone')
    .eq('facility_did', session.facilityDid)
    .single();

  const timestamp = new Date().toISOString();
  const message = `🚨 HUUID EMERGENCY\nFacility: ${session.facilityName}\nDid: ${session.facilityDid}\nTime: ${timestamp}\nIssue: ${parsed.data.issue}\nContact: ${facility?.login_phone ?? 'unknown'}`;

  try {
    // 'normal' per operator's explicit categorization -- counterintuitive
    // for an emergency-labeled message, but this is a low-volume,
    // non-time-critical operator alert, not a patient-safety OTP.
    await sendSMS(rootAuthorityPhone, message, 'normal');
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'facility_emergency_sms_failed', message: reason }));
    return NextResponse.json({ error: 'Could not send the alert. Please call the Root Authority directly.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
