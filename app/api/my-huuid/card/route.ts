import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';
import { loadCardData } from '@/lib/my-huuid-card-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/my-huuid/card — my-huuid Layer 5. Builds a fresh QR token on
 * every call (lib/qr-token.ts never persists one) but does NOT bump
 * card_token_generated_at -- viewing the card is not the same event as
 * "downloaded/refreshed a card", which is what that column tracks for
 * the staleness check. Only POST /api/my-huuid/refresh-card and the
 * medical-profile PATCH bump it. */
export async function GET() {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const client = getServiceClient();
  const data = await loadCardData(client, session.huuid);
  if (!data) {
    return NextResponse.json({ error: 'No Healthcare Identity found for this session.' }, { status: 404 });
  }

  return NextResponse.json(data);
}
