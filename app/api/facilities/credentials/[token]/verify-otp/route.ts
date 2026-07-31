import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase-server';
import { hashOtp } from '@/lib/otp';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits.') });

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'credential_delivery_otp');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Code must be 6 digits.' }, { status: 400 });
  }

  const { data, error } = await getServiceClient().rpc('huuid_verify_credential_otp', {
    p_download_token: params.token,
    p_otp_hash: hashOtp(parsed.data.code),
  });
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'credential_otp_verify_failed', message: error.message }));
    return NextResponse.json({ error: 'Could not verify the code.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Incorrect code, or this link has expired.' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
