import { NextResponse } from 'next/server';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function countRows(table: string): Promise<number | null> {
  try {
    const { count, error } = await getServiceClient()
      .from(table)
      .select('id', { count: 'exact', head: true });
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/** GET /api/health — unauthenticated. 200 healthy, 503 when the database is down. */
export async function GET() {
  let database = 'connected';
  try {
    const { error } = await getServiceClient()
      .from('huuid_did_documents')
      .select('id', { count: 'exact', head: true });
    if (error) database = 'error';
  } catch {
    database = 'error';
  }

  const healthy = database === 'connected';

  const [bgAuditLogCount, bgRateLimitCount, activeFacilitySuspensionCount] = await Promise.all([
    countRows('huuid_bg_audit_log'),
    countRows('huuid_bg_rate_limit'),
    (async () => {
      try {
        const { count, error } = await getServiceClient()
          .from('huuid_facility_suspensions')
          .select('id', { count: 'exact', head: true })
          .eq('active', true);
        if (error) return null;
        return count ?? 0;
      } catch {
        return null;
      }
    })(),
  ]);

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: RESOLVER_VERSION,
      database,
      services: { supabase: healthy ? 'ok' : 'error' },
      breakGlass: {
        bg_audit_log: bgAuditLogCount,
        bg_rate_limit: bgRateLimitCount,
        facility_suspensions_active: activeFacilitySuspensionCount,
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
