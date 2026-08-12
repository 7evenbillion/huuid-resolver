import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { patientSession } from '@/lib/patient-session';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { initiateDocumentVerification, isSmileIdConfigured, SmileIdNotConfiguredError } from '@/lib/smile-id';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/my-huuid/verify-identity/start — dedup Layer 7. Same as
 * /api/enroll/verify-identity/start (dedup Layer 3), but for a returning,
 * already-enrolled patient who skipped verification at enrollment and is
 * completing it later from the dashboard -- so identity comes from
 * patientSession (an authenticated login), not postEnrollmentSession (a
 * just-enrolled, not-yet-logged-in session).
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_verify_identity_start');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  if (!isSmileIdConfigured()) {
    return NextResponse.json({ error: 'Identity verification is not available right now.' }, { status: 503 });
  }

  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const selfie = form.get('selfie_image');
  const documentFront = form.get('document_front');
  const livenessImages = form.getAll('liveness_images');
  const countryCode = form.get('country_code');
  const documentType = form.get('document_type');
  const noticePrivacyPolicyUrl = form.get('notice_privacy_policy_url');

  if (
    !(selfie instanceof Blob) ||
    !(documentFront instanceof Blob) ||
    livenessImages.length < 6 ||
    !livenessImages.every((f) => f instanceof Blob) ||
    typeof countryCode !== 'string' ||
    typeof noticePrivacyPolicyUrl !== 'string'
  ) {
    return NextResponse.json({ error: 'Missing or invalid capture data. Please try again.' }, { status: 400 });
  }

  const client = getServiceClient();
  const piiKey = getPiiKey();

  const { data: profileRows } = await client.rpc('huuid_get_patient_profile', {
    p_huuid: session.huuid,
    p_pii_key: piiKey,
  });
  const profile = (Array.isArray(profileRows) ? profileRows[0] : profileRows) as
    | { full_name: string; phone: string }
    | undefined;
  if (!profile) {
    return NextResponse.json({ error: 'Could not find your Healthcare Identity record.' }, { status: 404 });
  }
  const nameParts = profile.full_name.trim().split(/\s+/);
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0];
  const givenNames = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : nameParts[0];

  try {
    const job = await initiateDocumentVerification({
      huuid: session.huuid,
      selfieImage: selfie,
      livenessImages: livenessImages as Blob[],
      documentFront,
      countryCode,
      documentType: typeof documentType === 'string' ? documentType : undefined,
      givenNames,
      lastName,
      phone: profile.phone,
      consent: { noticeLanguage: 'EN', noticePrivacyPolicyUrl },
    });

    const { error: pendingError } = await client.rpc('huuid_smile_id_log_insert_pending', {
      p_huuid: session.huuid,
      p_job_id: job.jobId,
      p_job_type: 'document_verification',
      p_document_type: typeof documentType === 'string' ? documentType : null,
      p_document_country: countryCode,
    });
    if (pendingError) {
      console.error(
        JSON.stringify({ level: 'warn', action: 'my_huuid_verify_identity_start_pending_log_failed', message: pendingError.message })
      );
    }

    await writeEnrollmentAudit({
      huuid: session.huuid,
      action: 'identity_verified_smile_id',
      ipHash,
      userAgentHash: uaHash,
      outcome: 'submitted_from_dashboard',
      details: { job_id: job.jobId },
    });

    return NextResponse.json({ ok: true, jobId: job.jobId });
  } catch (err) {
    const reason = err instanceof SmileIdNotConfiguredError ? err.message : err instanceof Error ? err.message : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'my_huuid_verify_identity_start_failed', message: reason }));
    await writeEnrollmentAudit({
      huuid: session.huuid,
      action: 'identity_verification_failed',
      ipHash,
      userAgentHash: uaHash,
      outcome: reason,
    });
    return NextResponse.json({ error: 'Could not submit your verification. Please try again.' }, { status: 502 });
  }
}
