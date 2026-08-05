import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { myHuuidPinChallenge } from '@/lib/my-huuid-login-session';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  huuid: z.string().regex(/^did:huuid:[a-z]{2}:[1-9A-HJ-NP-Za-km-z]+$/, 'Malformed HUUID.'),
});

/**
 * POST /api/my-huuid/login/pin/challenge — step 1 of PIN login. Returns
 * the encrypted private key blob (already client-side-encrypted, safe to
 * return to the browser that owns it) plus a fresh random nonce for the
 * client to sign as proof of successful decryption.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_pin_challenge');
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
    return NextResponse.json({ error: 'Enter a valid HUUID.' }, { status: 400 });
  }

  const client = getServiceClient();
  const { data: rows } = await client.rpc('huuid_get_patient_for_login', {
    p_huuid: parsed.data.huuid,
    p_pii_key: getPiiKey(),
  });
  const row = Array.isArray(rows) ? rows[0] : rows;

  if (!row || row.status !== 'active' || !row.encrypted_private_key) {
    return NextResponse.json({ error: 'No active Healthcare Identity found for that HUUID.' }, { status: 404 });
  }

  const nonceB64 = randomBytes(32).toString('base64url');
  await myHuuidPinChallenge.set({
    huuid: parsed.data.huuid,
    nonceB64,
    phone: row.phone ?? null,
    createdAt: Date.now(),
  });

  return NextResponse.json({
    encryptedPrivateKeyB64: row.encrypted_private_key,
    pbkdf2SaltB64: row.pbkdf2_salt,
    pbkdf2IvB64: row.pbkdf2_iv,
    nonce: nonceB64,
  });
}
