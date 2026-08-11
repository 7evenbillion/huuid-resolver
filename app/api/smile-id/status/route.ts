import { NextResponse } from 'next/server';
import { isSmileIdConfigured } from '@/lib/smile-id';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/smile-id/status — tells the client which of the three /enroll/verify-identity paths to show (not configured / sandbox / production). No secrets exposed, safe to be unauthenticated. */
export async function GET() {
  return NextResponse.json({
    configured: isSmileIdConfigured(),
    environment: process.env.SMILE_ID_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  });
}
