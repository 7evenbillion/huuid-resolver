import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { adminSession } from '@/lib/admin-session';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { generateFacilityDid, generateFacilityKeypair } from '@/lib/facility-keypair';
import { generateOtp, hashOtp, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://huuid-resolver.vercel.app';
const CREDENTIAL_DELIVERY_EXPIRY_HOURS = 24;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await adminSession.get();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const client = getServiceClient();
  const { data: app, error: fetchError } = await client
    .from('huuid_facility_applications')
    .select('*')
    .eq('application_id', params.id)
    .single();

  if (fetchError || !app) {
    return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  }
  if (app.status !== 'pending') {
    return NextResponse.json({ error: `Application is already ${app.status}.` }, { status: 409 });
  }

  const facilityDid = generateFacilityDid(app.country_code, app.facility_name, app.government_registration_number);
  const { publicKeyMultibase, publicKeyPem, privateKeyPem } = generateFacilityKeypair();

  const { error: facilityInsertError } = await client.from('huuid_facilities').insert({
    facility_did: facilityDid,
    facility_name: app.facility_name,
    certificate_status: 'active',
    public_key_multibase: publicKeyMultibase,
  });
  if (facilityInsertError) {
    console.error(JSON.stringify({ level: 'error', action: 'admin_approve_facility_insert_failed', message: facilityInsertError.message }));
    return NextResponse.json({ error: 'Could not create the facility record.' }, { status: 500 });
  }

  const downloadToken = randomBytes(32).toString('base64url');
  const otp = generateOtp();
  const downloadUrl = `${APP_URL}/facilities/credentials/${downloadToken}`;
  const expiresAt = new Date(Date.now() + CREDENTIAL_DELIVERY_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  const { error: deliveryError } = await client.rpc('huuid_create_credential_delivery', {
    p_facility_did: facilityDid,
    p_download_token: downloadToken,
    p_download_url: downloadUrl,
    p_expires_at: expiresAt,
    p_otp_hash: hashOtp(otp),
    p_private_key_pem: privateKeyPem,
    p_public_key_pem: publicKeyPem,
    p_pii_key: getPiiKey(),
  });
  if (deliveryError) {
    console.error(JSON.stringify({ level: 'error', action: 'admin_approve_credential_delivery_failed', message: deliveryError.message }));
    return NextResponse.json({ error: 'Could not create the credential delivery record.' }, { status: 500 });
  }

  const { error: updateError } = await client
    .from('huuid_facility_applications')
    .update({ status: 'approved', approved_at: new Date().toISOString(), facility_did: facilityDid, updated_at: new Date().toISOString() })
    .eq('application_id', params.id);
  if (updateError) {
    console.error(JSON.stringify({ level: 'error', action: 'admin_approve_application_update_failed', message: updateError.message }));
    return NextResponse.json({ error: 'Could not update the application record.' }, { status: 500 });
  }

  // SMS sends are best-effort -- the facility record and credential
  // delivery are already durably created. Spaced out (build brief calls
  // for the OTP arriving "30 seconds later" as a separate message; a full
  // synchronous 30s hold is avoided here given serverless execution-time
  // limits -- shortened to a few seconds per send, disclosed deviation).
  try {
    await sendSMS(
      app.authorised_signatory_phone,
      `HUUID FACILITY APPROVED\n\n${app.facility_name} has been approved to connect to the HUUID network.\n\nYour Facility ID:\n${facilityDid}\n\nDownload your credentials here:\n${downloadUrl}\n\nThis link expires in 24 hours and can only be used once. You will need a verification code -- we will send it separately.\n\nHUUID Root Authority`
    );
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'admin_approve_signatory_sms_failed', message: reason }));
  }

  await sleep(4000);
  try {
    await sendSMS(
      app.authorised_signatory_phone,
      `Your HUUID credential download code: ${otp}. Valid ${OTP_EXPIRY_MINUTES} minutes. Do not share this code. HUUID`
    );
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'admin_approve_otp_sms_failed', message: reason }));
  }

  await sleep(4000);
  try {
    await sendSMS(
      app.it_contact_phone,
      `HUUID Installation Ready\n\n${app.facility_name} has been approved. Your IT contact ${app.it_contact_name} -- installation instructions will follow your authorised contact's credential download.\nHUUID`
    );
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'admin_approve_it_contact_sms_failed', message: reason }));
  }

  return NextResponse.json({ ok: true, facilityDid, downloadUrl });
}
