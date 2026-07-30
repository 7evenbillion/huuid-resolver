import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { facilityApplicationSchema } from '@/lib/facility-schemas';
import { FACILITY_TYPE_SMS_LABELS } from '@/lib/facility-types';
import { checkEnrollmentRateLimit, requesterIpHash } from '@/lib/enrollment-rate-limit';
import { generateApplicationId } from '@/lib/facility-ids';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST /api/facilities/register (Layer 2) — public, no login required.
 * Validates the application, stores it as 'pending', notifies the
 * authorised signatory and the Root Authority by SMS.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'facility_application');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many applications from this network. Please try again later.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = facilityApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid form data.', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const applicationId = generateApplicationId();
  const client = getServiceClient();

  const { error: insertError } = await client.from('huuid_facility_applications').insert({
    application_id: applicationId,
    facility_name: input.facilityName,
    facility_type: input.facilityType,
    country_code: input.countryCode,
    region: input.region,
    physical_address: input.physicalAddress,
    government_registration_number: input.governmentRegistrationNumber,
    authorised_signatory_name: input.authorisedSignatoryName,
    authorised_signatory_role: input.authorisedSignatoryRole,
    authorised_signatory_phone: input.authorisedSignatoryPhone,
    authorised_signatory_email: input.authorisedSignatoryEmail ?? null,
    it_contact_name: input.itContactName,
    it_contact_phone: input.itContactPhone,
    emr_system: input.emrSystem,
    estimated_daily_patients: input.estimatedDailyPatients,
    declaration_accepted: true,
    declaration_timestamp: new Date().toISOString(),
    declaration_ip_hash: ipHash,
    status: 'pending',
  });

  if (insertError) {
    console.error(
      JSON.stringify({ level: 'error', action: 'facility_application_insert_failed', message: insertError.message })
    );
    return NextResponse.json({ error: 'Could not submit your application. Please try again.' }, { status: 500 });
  }

  // Both SMS sends are best-effort — the application is already durably
  // stored. A failed notification is logged, not surfaced as a submission
  // failure (same convention as the enrollment flow's confirmation SMS).
  try {
    await sendSMS(
      input.authorisedSignatoryPhone,
      `Your HUUID facility connection application has been received.\nApplication ID: ${applicationId}\nWe will review your application within 2 business days and contact you at this number.\nHUUID`
    );
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'facility_application_signatory_sms_failed', message: reason }));
  }

  const rootAuthorityPhone = process.env.HUUID_ROOT_AUTHORITY_PHONE;
  if (rootAuthorityPhone) {
    // A short gap before the second SMS to the same/nearby recipient --
    // sending two messages back-to-back in one request is a known trigger
    // for aggregator/carrier throttling on shared bulk sender routes (the
    // build brief itself calls for spacing between related messages in
    // the approve flow below, for the same reason).
    await sleep(4000);
    try {
      await sendSMS(
        rootAuthorityPhone,
        `NEW FACILITY APPLICATION\n${input.facilityName}\n${FACILITY_TYPE_SMS_LABELS[input.facilityType]} - ${input.countryCode}\nRef: ${applicationId}\nReview it in the HUUID admin dashboard.\nHUUID`
      );
    } catch (err) {
      const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
      console.error(JSON.stringify({ level: 'warn', action: 'facility_application_root_authority_sms_failed', message: reason }));
    }
  } else {
    console.warn(
      JSON.stringify({ level: 'warn', action: 'facility_application_root_authority_sms_skipped', message: 'HUUID_ROOT_AUTHORITY_PHONE not set' })
    );
  }

  return NextResponse.json({ ok: true, applicationId });
}
