import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { facilitySession } from '@/lib/facility-session';
import { generateConsentId } from '@/lib/facility-ids';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONSENT_EXPIRY_MINUTES = 5;

const schema = z.object({
  huuid: z.string().min(1),
  holdingFacilityNames: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest) {
  const session = await facilitySession.get();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const client = getServiceClient();
  const piiKey = getPiiKey();

  const { data: contactRows } = await client.rpc('huuid_get_patient_contact', {
    p_huuid: parsed.data.huuid,
    p_pii_key: piiKey,
  });
  const contact = Array.isArray(contactRows) ? contactRows[0] : contactRows;
  const phone: string | null = contact?.phone ?? null;

  if (!phone) {
    return NextResponse.json(
      { error: 'This patient has no phone number on file — consent cannot be requested by SMS.' },
      { status: 422 }
    );
  }

  const { data: phoneHashRows } = await client.rpc('huuid_hash_phone', { p_phone: phone, p_pii_key: piiKey });
  const phoneHash = Array.isArray(phoneHashRows) ? phoneHashRows[0] : phoneHashRows;

  const consentId = generateConsentId();
  const expiresAt = new Date(Date.now() + CONSENT_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const recordTypesRequested = ['Lab results', 'Medications'];
  const holdingFacilityNames = parsed.data.holdingFacilityNames.length
    ? parsed.data.holdingFacilityNames
    : ['this facility'];

  const { error: insertError } = await client.from('huuid_consent_requests').insert({
    consent_id: consentId,
    huuid: parsed.data.huuid,
    requesting_facility_did: session.facilityDid,
    requesting_facility_name: session.facilityName,
    record_types_requested: recordTypesRequested,
    holding_facility_names: holdingFacilityNames,
    consent_method: 'sms',
    status: 'pending',
    patient_phone_hash: phoneHash,
    expires_at: expiresAt,
  });
  if (insertError) {
    console.error(JSON.stringify({ level: 'error', action: 'consent_request_insert_failed', message: insertError.message }));
    return NextResponse.json({ error: 'Could not create the consent request.' }, { status: 500 });
  }

  try {
    await sendSMS(
      phone,
      `HUUID CONSENT REQUEST\n\n${session.facilityName} wants to access your health records at:\n- ${holdingFacilityNames.join('\n- ')}\n\nThey need:\n- ${recordTypesRequested.join('\n- ')}\n\nReply YES to consent or NO to decline.\nExpires in ${CONSENT_EXPIRY_MINUTES} minutes.\nRef: ${consentId}\nHUUID`,
      'normal'
    );
    await client
      .from('huuid_consent_requests')
      .update({ sms_sent_at: new Date().toISOString() })
      .eq('consent_id', consentId);
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'consent_request_sms_failed', message: reason }));
  }

  return NextResponse.json({ ok: true, consentId, expiresAt });
}
