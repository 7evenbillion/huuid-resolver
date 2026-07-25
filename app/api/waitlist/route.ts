import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/waitlist — captures the homepage's "Get Your HUUID" interest
 * signal into huuid_waitlist (migration 012). Server-side only, via the
 * service client -- huuid_waitlist has no anon/authenticated grant,
 * matching every other huuid_ table's access pattern in this shared
 * project.
 */
export async function POST(req: NextRequest) {
  let body: { email?: unknown; country?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const country = typeof body.country === 'string' ? body.country.trim() : null;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  const { error } = await getServiceClient()
    .from('huuid_waitlist')
    .insert({ email, country: country || null });

  if (error) {
    console.error(
      JSON.stringify({ level: 'error', action: 'waitlist_insert_failed', message: error.message })
    );
    return NextResponse.json({ error: 'Could not register your interest. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
