import { NextRequest, NextResponse } from 'next/server';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * TEMPORARY debug route — standalone SMS delivery test, not wired to any
 * feature. Calls the exact same lib/sms.ts used everywhere else in this
 * app, but from a real Vercel serverless invocation (not a local script),
 * to rule out any environment-specific difference between "sent from my
 * sandbox" and "sent from production." Remove after diagnosis is done.
 */
export async function POST(req: NextRequest) {
  let bodyPhone: string | null = null;
  try {
    const body = (await req.json()) as { to?: string };
    bodyPhone = body?.to ?? null;
  } catch {
    // no body / not JSON -- fall back to default number below
  }
  const testNumber = bodyPhone || '+233243222058';
  const message = `HUUID standalone test ${Date.now()}. If you receive this, delivery from production works. HUUID`;

  try {
    const result = await sendSMS(testNumber, message);
    return NextResponse.json({ ok: true, ...result, sentAt: new Date().toISOString(), to: testNumber });
  } catch (err) {
    if (err instanceof SMSDeliveryError) {
      return NextResponse.json(
        { ok: false, hubtelReason: err.hubtelReason, africasTalkingReason: err.africasTalkingReason },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 }
    );
  }
}
