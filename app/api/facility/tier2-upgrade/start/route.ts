import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { facilitySession } from '@/lib/facility-session';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { verifyFaceAtFacility, isSmileIdConfigured, SmileIdNotConfiguredError } from '@/lib/smile-id';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/facility/tier2-upgrade/start — Layer 5, Smile ID face-match
 * path. Submits a freshly captured facility selfie against the
 * patient's own enrolled Smile ID face (verifyFaceAtFacility, Layer 1).
 * Async like every other v3 endpoint -- this only confirms submission;
 * the actual match result arrives via the Layer 4 callback, which
 * branches on job_type === 'smart_selfie_authentication' to call
 * huuid_complete_tier2_upgrade instead of the enrollment-verification
 * completion path.
 *
 * Requires the patient to already have an enrolled Smile ID face
 * (smile_id_smile_reference, set by Layer 3/4 at enrollment time) --
 * a patient who skipped that step has nothing to match against here,
 * regardless of whether Smile ID is configured. The client should fall
 * back to /api/facility/tier2-upgrade/staff-verified in that case.
 */
export async function POST(req: NextRequest) {
  const session = await facilitySession.get();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  if (!isSmileIdConfigured()) {
    return NextResponse.json({ error: 'Face-match verification is not available right now.' }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const huuid = form.get('huuid');
  const selfie = form.get('selfie_image');
  const livenessImages = form.getAll('liveness_images');
  const noticePrivacyPolicyUrl = form.get('notice_privacy_policy_url');

  if (
    typeof huuid !== 'string' ||
    !(selfie instanceof Blob) ||
    livenessImages.length < 6 ||
    !livenessImages.every((f) => f instanceof Blob) ||
    typeof noticePrivacyPolicyUrl !== 'string'
  ) {
    return NextResponse.json({ error: 'Missing or invalid capture data.' }, { status: 400 });
  }

  const client = getServiceClient();
  const piiKey = getPiiKey();

  const { data: refRows } = await client.rpc('huuid_get_smile_id_reference', { p_huuid: huuid });
  const ref = (Array.isArray(refRows) ? refRows[0] : refRows) as { smile_id_smile_reference: string | null } | undefined;
  if (!ref?.smile_id_smile_reference) {
    return NextResponse.json(
      { error: 'This patient has no enrolled face on file. Use document-only verification instead.', code: 'no_enrolled_face' },
      { status: 409 }
    );
  }

  const { data: profileRows } = await client.rpc('huuid_get_patient_profile', { p_huuid: huuid, p_pii_key: piiKey });
  const profile = (Array.isArray(profileRows) ? profileRows[0] : profileRows) as
    | { full_name: string; phone: string }
    | undefined;
  if (!profile) {
    return NextResponse.json({ error: 'Could not find this patient.' }, { status: 404 });
  }
  const nameParts = profile.full_name.trim().split(/\s+/);
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0];
  const givenNames = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : nameParts[0];

  const ipHash = createHash('sha256').update(req.headers.get('x-forwarded-for') ?? 'unknown').digest('hex');
  const uaHash = createHash('sha256').update(req.headers.get('user-agent') ?? 'unknown').digest('hex');

  try {
    const job = await verifyFaceAtFacility({
      huuid,
      smileIdUserId: ref.smile_id_smile_reference,
      selfieImage: selfie,
      livenessImages: livenessImages as Blob[],
      givenNames,
      lastName,
      phone: profile.phone,
      consent: { noticeLanguage: 'EN', noticePrivacyPolicyUrl },
    });

    const { error: pendingError } = await client.rpc('huuid_smile_id_log_insert_pending', {
      p_huuid: huuid,
      p_job_id: job.jobId,
      p_job_type: 'smart_selfie_authentication',
      p_document_type: null,
      p_document_country: null,
    });
    if (pendingError) {
      console.error(
        JSON.stringify({ level: 'warn', action: 'tier2_start_pending_log_failed', message: pendingError.message })
      );
    }

    await writeEnrollmentAudit({
      huuid,
      action: 'identity_verified_smile_id',
      ipHash,
      userAgentHash: uaHash,
      outcome: 'tier2_submitted',
      details: { job_id: job.jobId, verifying_facility_did: session.facilityDid },
    });

    return NextResponse.json({ ok: true, jobId: job.jobId });
  } catch (err) {
    const reason = err instanceof SmileIdNotConfiguredError ? err.message : err instanceof Error ? err.message : 'unknown';
    console.error(JSON.stringify({ level: 'error', action: 'tier2_start_failed', message: reason }));
    return NextResponse.json({ error: 'Could not submit verification. Please try again.' }, { status: 502 });
  }
}
