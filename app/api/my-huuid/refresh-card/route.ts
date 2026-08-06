import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';
import { loadCardData } from '@/lib/my-huuid-card-data';
import { markCardTokenGenerated } from '@/lib/card-token-timestamp';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/my-huuid/refresh-card — my-huuid Layer 5. Regenerates the QR
 * token with a new 90-day expiry (lib/qr-token.ts's DEFAULT_TTL_SECONDS)
 * and bumps card_token_generated_at, clearing both the staleness and
 * expiry-warning banners on the client. */
export async function POST(req: NextRequest) {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_refresh_card');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const client = getServiceClient();
  await markCardTokenGenerated(client, session.huuid);

  const data = await loadCardData(client, session.huuid);
  if (!data) {
    return NextResponse.json({ error: 'No Healthcare Identity found for this session.' }, { status: 404 });
  }

  return NextResponse.json(data);
}
