import { NextRequest, NextResponse } from 'next/server';
import { adminSession } from '@/lib/admin-session';
import { getServiceClient } from '@/lib/supabase-server';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SYSTEM_ACTOR_HASH = createHash('sha256').update('root-authority-admin-action').digest('hex');

/** POST /api/admin/duplicates/clear — "NOT A DUPLICATE" verdict: two different people with similar names/DOB. */
export async function POST(req: NextRequest) {
  const session = await adminSession.get();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const huuid = typeof body?.huuid === 'string' ? body.huuid : null;
  if (!huuid) return NextResponse.json({ error: 'Missing huuid.' }, { status: 400 });

  const client = getServiceClient();
  const { error } = await client.rpc('huuid_clear_duplicate_flag', { p_huuid: huuid });
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'admin_duplicate_clear_failed', message: error.message }));
    return NextResponse.json({ error: 'Could not clear this flag.' }, { status: 500 });
  }

  await writeEnrollmentAudit({
    huuid,
    action: 'potential_duplicate_flagged',
    ipHash: SYSTEM_ACTOR_HASH,
    userAgentHash: SYSTEM_ACTOR_HASH,
    outcome: 'cleared_by_root_authority',
  });

  return NextResponse.json({ ok: true });
}
