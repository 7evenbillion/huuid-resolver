import { randomUUID, createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { isSmileIdConfigured } from '@/lib/smile-id';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/my-huuid/verify-identity/sandbox — dedup Layer 7 sandbox
 * path, mirroring /api/enroll/verify-identity/sandbox (dedup Layer 3)
 * for a returning patient completing verification from the dashboard
 * instead of at enrollment. Same fabricated-result caveat applies: no
 * real Smile ID sandbox account is configured in this environment, so
 * this simulates a plausible-shaped success rather than calling a real
 * endpoint. See the enrollment route's header comment for the full
 * rationale.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'my_huuid_verify_identity_sandbox');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  if (isSmileIdConfigured() && process.env.SMILE_ID_ENVIRONMENT === 'production') {
    return NextResponse.json({ error: 'Sandbox verification is not available in production mode.' }, { status: 400 });
  }

  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const documentType = typeof (body as { documentType?: unknown })?.documentType === 'string'
    ? (body as { documentType: string }).documentType
    : 'national_id';
  const documentCountry = typeof (body as { documentCountry?: unknown })?.documentCountry === 'string'
    ? (body as { documentCountry: string }).documentCountry
    : 'GH';

  const client = getServiceClient();
  const jobId = `sandbox-simulated-${randomUUID()}`;
  const smileReference = `sandbox-simulated-${randomUUID()}`;
  const biometricCommitmentHash = createHash('sha256').update(`${smileReference}:${session.huuid}`).digest('hex');

  const { error: logError } = await client.from('huuid_smile_id_log').insert({
    huuid: session.huuid,
    job_id: jobId,
    job_type: 'document_verification',
    smile_reference: smileReference,
    document_type: documentType,
    document_country: documentCountry,
    result_code: '0000',
    result_text: 'Sandbox-simulated success (no real Smile ID account configured this session)',
    confidence_value: 100,
    actions_liveness_check: 'Passed',
    actions_register_selfie: 'Passed',
    actions_verify_document: 'Passed',
    actions_return_personal_info: 'Passed',
    raw_response: { simulated: true },
  });
  if (logError) {
    console.error(JSON.stringify({ level: 'error', action: 'my_huuid_verify_identity_sandbox_log_failed', message: logError.message }));
    return NextResponse.json({ error: 'Could not complete verification. Please try again.' }, { status: 500 });
  }

  const { error: completeError } = await client.rpc('huuid_complete_smile_id_verification', {
    p_huuid: session.huuid,
    p_biometric_commitment_hash: biometricCommitmentHash,
    p_document_type: documentType,
    p_document_country: documentCountry,
    p_smile_job_id: jobId,
    p_smile_id_smile_reference: smileReference,
  });
  if (completeError) {
    console.error(
      JSON.stringify({ level: 'error', action: 'my_huuid_verify_identity_sandbox_complete_failed', message: completeError.message })
    );
    return NextResponse.json({ error: 'Could not complete verification. Please try again.' }, { status: 500 });
  }

  await writeEnrollmentAudit({
    huuid: session.huuid,
    action: 'identity_verified_smile_id',
    ipHash,
    userAgentHash: uaHash,
    outcome: 'sandbox_simulated_from_dashboard',
  });

  return NextResponse.json({ ok: true });
}
