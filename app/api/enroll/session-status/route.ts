import { NextResponse } from 'next/server';
import { enrollmentSession } from '@/lib/enrollment-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/enroll/session-status — lets the OTP screen show "last 4 digits
 * of your phone" without ever storing the phone number client-side
 * (localStorage/sessionStorage/URL params) between the two screens.
 */
export async function GET() {
  const session = await enrollmentSession.get();
  if (!session) {
    return NextResponse.json({ error: 'No active enrollment session.' }, { status: 400 });
  }
  return NextResponse.json({
    phoneLast4: session.phone.slice(-4),
    phoneVerified: session.phoneVerified,
    countryCode: session.countryCode,
  });
}
