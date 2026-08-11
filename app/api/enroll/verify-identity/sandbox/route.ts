import { randomUUID, createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { postEnrollmentSession } from '@/lib/post-enrollment-session';
import { checkEnrollmentRateLimit, requesterIpHash, userAgentHash } from '@/lib/enrollment-rate-limit';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { isSmileIdConfigured } from '@/lib/smile-id';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/enroll/verify-identity/sandbox — dedup Layer 3, sandbox path.
 *
 * NOT a real Smile ID call. This session has no SMILE_ID_PARTNER_ID/
 * SMILE_ID_API_KEY configured anywhere (no sandbox account exists to
 * test against), so this fabricates a plausible-shaped verification
 * result rather than fake-calling a real endpoint. job_id and
 * smile_reference are prefixed `sandbox-simulated-` specifically so
 * they can never be mistaken for a real Smile ID identifier once a real
 * account exists. Exercises the full downstream pipeline this layer
 * depends on (huuid_smile_id_log write, identity_verified flip,
 * biometric_commitment_hash population feeding T1 in lib/dedup-
 * scoring.ts) even though the "verification" itself is fake.
 *
 * Once a real Smile ID sandbox account is configured, this route should
 * be replaced by a real POST /v3/document_verification call using
 * their documented sandbox test document numbers and the `sandbox_result`
 * request field (confirmed present in their real API schema, lib/smile-
 * id.ts) to force deterministic outcomes -- not deleted, since a
 * placeholder-based simulation may still be useful for local dev without
 * live credentials.
 */
export async function POST(req: NextRequest) {
  const ipHash = requesterIpHash(req);
  const uaHash = userAgentHash(req);

  const allowed = await checkEnrollmentRateLimit(ipHash, 'verify_identity_sandbox');
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  if (isSmileIdConfigured() && process.env.SMILE_ID_ENVIRONMENT === 'production') {
    return NextResponse.json({ error: 'Sandbox verification is not available in production mode.' }, { status: 400 });
  }

  const session = await postEnrollmentSession.get();
  if (!session) {
    return NextResponse.json({ error: 'Your enrollment session has expired.' }, { status: 401 });
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
  // T1's input: a one-way hash of the (simulated) verification reference,
  // never the raw biometric -- same construction the real Layer 4
  // callback will use.
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
    console.error(JSON.stringify({ level: 'error', action: 'verify_identity_sandbox_log_failed', message: logError.message }));
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
      JSON.stringify({ level: 'error', action: 'verify_identity_sandbox_complete_failed', message: completeError.message })
    );
    return NextResponse.json({ error: 'Could not complete verification. Please try again.' }, { status: 500 });
  }

  await writeEnrollmentAudit({
    huuid: session.huuid,
    action: 'identity_verified_smile_id',
    ipHash,
    userAgentHash: uaHash,
    outcome: 'sandbox_simulated',
  });

  return NextResponse.json({ ok: true });
}
