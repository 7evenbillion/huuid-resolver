import { NextRequest, NextResponse as NR } from 'next/server';
import { webcrypto } from 'node:crypto';
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase-server';
import { myHuuidPinChallenge } from '@/lib/my-huuid-login-session';
import { patientSession } from '@/lib/patient-session';
import { decodeEd25519PublicKeyMultibase } from '@/lib/multibase';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ signatureB64: z.string().min(1) });

interface DidVerificationMethod {
  publicKeyMultibase?: string;
}
interface DidDocument {
  verificationMethod?: DidVerificationMethod[];
}

/**
 * POST /api/my-huuid/login/pin/verify — step 2 of PIN login. The client
 * has already decrypted its private key locally (proving PIN knowledge)
 * and signed the challenge nonce with it; this route verifies that
 * signature against the patient's already-public DID Document key. A
 * valid signature is cryptographic proof of PIN knowledge -- stronger
 * than trusting a client-reported "decrypt succeeded" boolean, which
 * would let anyone log in without ever knowing the PIN.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_pin_verify');
  if (!allowed) {
    return NR.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const challenge = await myHuuidPinChallenge.get();
  if (!challenge) {
    return NR.json({ error: 'Your sign-in session expired. Please try again.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NR.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NR.json({ error: 'Incorrect PIN.' }, { status: 401 });
  }

  const client = getServiceClient();
  const { data: didDocRow } = await client
    .from('huuid_did_documents')
    .select('did_document')
    .eq('huuid', challenge.huuid)
    .single();

  const didDocument = didDocRow?.did_document as DidDocument | undefined;
  const publicKeyMultibase = didDocument?.verificationMethod?.[0]?.publicKeyMultibase;
  if (!publicKeyMultibase) {
    return NR.json({ error: 'Could not verify — no key on record.' }, { status: 500 });
  }

  const rawPublicKey = decodeEd25519PublicKeyMultibase(publicKeyMultibase);
  if (!rawPublicKey) {
    return NR.json({ error: 'Could not verify — malformed key on record.' }, { status: 500 });
  }

  let verified = false;
  try {
    const publicKeyObject = await webcrypto.subtle.importKey(
      'raw',
      new Uint8Array(rawPublicKey),
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    verified = await webcrypto.subtle.verify(
      'Ed25519',
      publicKeyObject,
      Buffer.from(parsed.data.signatureB64, 'base64url'),
      Buffer.from(challenge.nonceB64, 'base64url')
    );
  } catch {
    verified = false;
  }

  if (!verified) {
    return NR.json({ error: 'Incorrect PIN.' }, { status: 401 });
  }

  await patientSession.set({
    huuid: challenge.huuid,
    phone: challenge.phone ?? '',
    phoneVerified: true,
    createdAt: Date.now(),
  });
  await myHuuidPinChallenge.clear();

  return NR.json({ ok: true });
}
