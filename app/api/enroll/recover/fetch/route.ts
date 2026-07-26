import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { recoverySession } from '@/lib/recovery-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RecoveryRow {
  id: string;
  huuid: string;
  full_name: string;
  country_code: string;
  encrypted_private_key: string;
  pbkdf2_salt: string;
  pbkdf2_iv: string;
  status: string;
}

/**
 * POST /api/enroll/recover/fetch — only reachable after phone OTP
 * verification. Hands back the *encrypted* private key blob so the client
 * can attempt AES-GCM decryption locally with a PIN the user enters. The
 * server never decrypts the private key itself, and this route runs no
 * decrypt attempt of any kind -- it only returns already-encrypted
 * material, which is safe to transmit over HTTPS.
 */
export async function POST(_req: NextRequest) {
  const session = await recoverySession.get();
  if (!session || !session.phoneVerified) {
    return NextResponse.json({ error: 'Phone number is not verified.' }, { status: 401 });
  }

  const { data: rowData, error } = await getServiceClient()
    .rpc('huuid_get_patient_for_recovery', { p_phone: session.phone, p_pii_key: getPiiKey() })
    .maybeSingle();
  const data = rowData as RecoveryRow | null;

  if (error || !data) {
    return NextResponse.json({ error: 'No enrolled identity found for this phone number.' }, { status: 404 });
  }

  if (data.status !== 'active') {
    return NextResponse.json(
      { error: 'This Healthcare Identity is not active. Visit a HUUID-connected facility for assistance.' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    huuid: data.huuid,
    fullName: data.full_name,
    countryCode: data.country_code,
    encryptedPrivateKey: data.encrypted_private_key,
    pbkdf2Salt: data.pbkdf2_salt,
    pbkdf2Iv: data.pbkdf2_iv,
  });
}
