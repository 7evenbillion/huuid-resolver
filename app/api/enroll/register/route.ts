import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { registerSchema } from '@/lib/enrollment-schemas';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { enrollmentSession } from '@/lib/enrollment-session';
import { postEnrollmentSession } from '@/lib/post-enrollment-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';
import { buildQrTokenPayload, signQrToken } from '@/lib/qr-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/enroll/register — Screen 2's final step. All PII (name, DOB,
 * sex, phone, email, emergency contact) is read from the server session,
 * NEVER from this request body — the body only carries the client-
 * generated cryptographic material (huuid, DID Document, encrypted
 * private key + salt/iv, optional WebAuthn credential id). The raw
 * private key itself never appears anywhere in this request.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'enrollment_register');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const session = await enrollmentSession.get();
  if (!session) {
    return NextResponse.json({ error: 'Your enrollment session has expired. Please start again.' }, { status: 400 });
  }
  if (!session.phoneVerified) {
    return NextResponse.json({ error: 'Phone number is not verified.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    await writeEnrollmentAudit({ huuid: null, action: 'enrollment_completed', ipHash, userAgentHash: uaHash, outcome: 'invalid_payload' });
    return NextResponse.json({ error: 'Invalid registration payload.' }, { status: 400 });
  }
  const input = parsed.data;

  const client = getServiceClient();
  const piiKey = getPiiKey();

  const { data: alreadyEnrolled } = await client.rpc('huuid_patient_exists_by_phone', {
    p_phone: session.phone,
    p_pii_key: piiKey,
  });
  if (alreadyEnrolled) {
    await writeEnrollmentAudit({ huuid: input.huuid, action: 'enrollment_completed', ipHash, userAgentHash: uaHash, outcome: 'duplicate_phone' });
    return NextResponse.json({ error: 'This phone number is already enrolled.' }, { status: 409 });
  }

  const { error: patientError } = await client.rpc('huuid_enroll_patient', {
    p_huuid: input.huuid,
    p_did_document: input.did_document,
    p_full_name: session.fullName,
    p_date_of_birth: session.dateOfBirth,
    p_sex_at_birth: session.sexAtBirth,
    p_country_code: session.countryCode,
    p_phone: session.phone,
    p_email: session.email,
    p_emergency_contact_name: session.emergencyContactName,
    p_emergency_contact_phone: session.emergencyContactPhone,
    p_encrypted_private_key: input.encrypted_private_key,
    p_pbkdf2_salt: input.pbkdf2_salt,
    p_pbkdf2_iv: input.pbkdf2_iv,
    p_webauthn_credential_id: input.webauthn_credential_id ?? null,
    p_consent_ip_hash: session.consentIpHash,
    p_pii_key: piiKey,
  });

  if (patientError) {
    console.error(JSON.stringify({ level: 'error', action: 'register_patient_insert_failed', message: patientError.message }));
    await writeEnrollmentAudit({ huuid: input.huuid, action: 'enrollment_completed', ipHash, userAgentHash: uaHash, outcome: 'failed' });
    return NextResponse.json({ error: 'Could not complete enrollment. Please try again.' }, { status: 500 });
  }

  const { error: didDocError } = await client.from('huuid_did_documents').insert({
    huuid: input.huuid,
    did_document: input.did_document,
    status: 'active',
    issuing_node: 'did:huuid:self-enrolled',
  });

  if (didDocError) {
    console.error(JSON.stringify({ level: 'error', action: 'register_did_document_insert_failed', message: didDocError.message }));
    await writeEnrollmentAudit({ huuid: input.huuid, action: 'enrollment_completed', ipHash, userAgentHash: uaHash, outcome: 'failed_did_registration' });
    return NextResponse.json({ error: 'Could not complete enrollment. Please try again.' }, { status: 500 });
  }

  await writeEnrollmentAudit({ huuid: input.huuid, action: 'enrollment_completed', ipHash, userAgentHash: uaHash, outcome: 'success' });

  try {
    await sendSMS(
      session.phone,
      `Your HUUID Healthcare Identity has been created successfully.\nYour HUUID: ${input.huuid}\nKeep this safe. This is your unique healthcare identity.\nHUUID`
    );
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    // Enrollment already succeeded -- a confirmation SMS failure doesn't undo it, just gets logged.
    console.error(JSON.stringify({ level: 'warn', action: 'register_confirmation_sms_failed', message: reason }));
  }

  if (session.email) {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.HUUID_ENROLLMENT_FROM_EMAIL;
    if (resendKey && fromEmail) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromEmail,
            to: session.email,
            subject: 'Your HUUID Healthcare Identity',
            text: `Your HUUID Healthcare Identity has been created.\n\nYour HUUID: ${input.huuid}\n\nKeep this safe -- it is your unique healthcare identity for life.`,
          }),
          cache: 'no-store',
        });
      } catch (err) {
        console.error(JSON.stringify({ level: 'warn', action: 'register_confirmation_email_failed', message: err instanceof Error ? err.message : 'unknown' }));
      }
    }
  }

  // Return the name/country back to the client that just submitted them --
  // this is not a new PII disclosure (the client already knows its own
  // input), and it lets the card screen render without ever needing a
  // "look up a patient's name by HUUID" endpoint, which would leak PII to
  // anyone who merely scans or guesses a HUUID/QR code.
  const fullName = session.fullName;
  const countryCode = session.countryCode;
  const sexAtBirth = session.sexAtBirth;

  await enrollmentSession.clear();

  // Opens the 30-minute window /api/enroll/medical checks — see
  // lib/post-enrollment-session.ts for why a new session is needed here
  // rather than extending the one just cleared above.
  await postEnrollmentSession.set({ huuid: input.huuid, createdAt: Date.now() });

  // Base QR token: no medical data yet (patient hasn't reached that screen).
  // /api/enroll/medical re-signs a fuller token once they fill it in, or
  // skip leaves this base token as the card's permanent QR content.
  const qrPayload = buildQrTokenPayload(input.huuid, {});
  const signed = signQrToken(qrPayload);

  return NextResponse.json({
    huuid: input.huuid,
    fullName,
    countryCode,
    sexAtBirth,
    success: true,
    qrToken: signed?.token ?? null,
    qrTokenUsingInterimKey: signed?.usingInterimKey ?? null,
  });
}
