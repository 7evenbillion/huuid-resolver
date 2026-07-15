import { NextResponse } from 'next/server';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: RESOLVER_VERSION,
      database,
      services: { supabase: healthy ? 'ok' : 'error' },
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
