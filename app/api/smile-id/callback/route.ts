import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { verifyWebhookSignature, parseVerificationWebhook } from '@/lib/smile-id';
import { writeEnrollmentAudit } from '@/lib/enrollment-audit';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/smile-id/callback — Layer 4. Publicly reachable (Smile ID
 * signs the payload rather than relying on network-level auth) --
 * NextRequest.headers.get() is already case-insensitive, matching the
 * exact header names their docs specify (Response-Signature,
 * Response-Timestamp).
 *
 * Correlates by huuid (partner_params.huuid, set at submission time by
 * initiateDocumentVerification), not job_id -- the webhook body itself
 * doesn't reliably carry job_id, only the Job-ID header and the
 * original synchronous AcceptedResponse do. See lib/smile-id.ts's
 * parseVerificationWebhook for the full reasoning.
 */

// huuid_audit_enrollment.ip_hash/user_agent_hash are NOT NULL -- this is
// a system-triggered write, not a live request. Same placeholder-hash
// convention as the SMS dispatcher (app/api/sms-dispatch) and migration
// 015's administrative-action audit writes.
const SYSTEM_ACTOR_HASH = createHash('sha256').update('system-smile-id-callback').digest('hex');

export async function POST(req: NextRequest) {
  const signature = req.headers.get('Response-Signature');
  const timestamp = req.headers.get('Response-Timestamp');

  if (!signature || !timestamp || !verifyWebhookSignature({ timestamp, signature })) {
    console.error(JSON.stringify({ level: 'error', action: 'smile_id_callback_signature_invalid' }));
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const result = parseVerificationWebhook(payload);
  if (!result.huuid) {
    console.error(JSON.stringify({ level: 'warn', action: 'smile_id_callback_no_huuid' }));
    return NextResponse.json({ received: true });
  }

  // Human-review-pending -- Smile ID sends a final webhook later. Nothing
  // to record yet.
  if (result.status === 'processing') {
    return NextResponse.json({ received: true });
  }

  const client = getServiceClient();

  const { data: pendingRows } = await client.rpc('huuid_get_latest_pending_smile_id_job', { p_huuid: result.huuid });
  const pending = (Array.isArray(pendingRows) ? pendingRows[0] : pendingRows) as
    | { job_id: string; job_type: string | null; document_type: string | null; document_country: string | null }
    | undefined;
  const smileUserId = req.headers.get('User-ID');

  // Layer 5: a facility Tier 2 re-verification (verifyFaceAtFacility,
  // product smart_selfie_authentication) is a face-match against an
  // ALREADY enrolled patient, not a new enrollment -- no document dedup,
  // no Smile Secure duplicate-face check (those exist to catch a new
  // enrollment reusing someone else's identity, not relevant when
  // re-confirming an existing one), just complete the tier upgrade.
  if (pending?.job_type === 'smart_selfie_authentication') {
    if (result.status !== 'clear') {
      await writeEnrollmentAudit({
        huuid: result.huuid,
        action: 'identity_verification_failed',
        ipHash: SYSTEM_ACTOR_HASH,
        userAgentHash: SYSTEM_ACTOR_HASH,
        outcome: `tier2_face_match_${result.reason ?? result.status}`,
      });
      return NextResponse.json({ received: true });
    }
    await client.rpc('huuid_complete_tier2_upgrade', { p_huuid: result.huuid });
    await client.rpc('huuid_smile_id_log_insert_result', {
      p_huuid: result.huuid,
      p_job_id: pending.job_id,
      p_job_type: result.product,
      p_smile_reference: smileUserId,
      p_document_type: null,
      p_document_country: null,
      p_result_code: '0000',
      p_result_text: result.message,
      p_confidence_value: null,
      p_duplicate_reference: null,
      p_raw_response: payload,
    });
    await writeEnrollmentAudit({
      huuid: result.huuid,
      action: 'tier2_upgrade_completed',
      ipHash: SYSTEM_ACTOR_HASH,
      userAgentHash: SYSTEM_ACTOR_HASH,
      outcome: 'smile_id_face_match',
    });
    await notifyPatientOfTier2Upgrade(client, result.huuid);
    return NextResponse.json({ received: true });
  }

  if (result.status !== 'clear') {
    await client.rpc('huuid_smile_id_log_insert_result', {
      p_huuid: result.huuid,
      p_job_id: pending?.job_id ?? 'unknown',
      p_job_type: result.product,
      p_smile_reference: smileUserId,
      p_document_type: pending?.document_type ?? null,
      p_document_country: pending?.document_country ?? null,
      p_result_code: result.status,
      p_result_text: result.message,
      p_confidence_value: null,
      p_duplicate_reference: null,
      p_raw_response: payload,
    });
    await writeEnrollmentAudit({
      huuid: result.huuid,
      action: 'identity_verification_failed',
      ipHash: SYSTEM_ACTOR_HASH,
      userAgentHash: SYSTEM_ACTOR_HASH,
      outcome: result.reason ?? result.status,
    });
    return NextResponse.json({ received: true });
  }

  // status === 'clear' from here on.

  // Step B (deferred from Layer 2): same government document already
  // anchors a different HUUID.
  if (result.documentNumber) {
    const country = pending?.document_country ?? 'XX';
    const documentHash = createHash('sha256').update(`${result.documentNumber}${country}`).digest('hex');
    const { data: existingRows } = await client.rpc('huuid_check_document_hash', { p_document_hash: documentHash });
    const existing = (Array.isArray(existingRows) ? existingRows : []) as { huuid: string }[];
    const other = existing.find((e) => e.huuid !== result.huuid);
    if (other) {
      await client.rpc('huuid_flag_potential_duplicate', {
        p_huuid: result.huuid,
        p_duplicate_of_huuid: other.huuid,
        p_pms_score: 0.99, // document-number match -- unambiguous, not a T1-T5 probabilistic signal
      });
      await client.rpc('huuid_smile_id_log_insert_result', {
        p_huuid: result.huuid,
        p_job_id: pending?.job_id ?? 'unknown',
        p_job_type: result.product,
        p_smile_reference: smileUserId,
        p_document_type: pending?.document_type ?? null,
        p_document_country: pending?.document_country ?? null,
        p_result_code: 'DUPLICATE_DOCUMENT',
        p_result_text: `Document already registered to ${other.huuid}`,
        p_confidence_value: null,
        p_duplicate_reference: other.huuid,
        p_raw_response: payload,
      });
      await writeEnrollmentAudit({
        huuid: result.huuid,
        action: 'duplicate_document_detected',
        ipHash: SYSTEM_ACTOR_HASH,
        userAgentHash: SYSTEM_ACTOR_HASH,
        outcome: 'flagged',
        details: { duplicate_of_huuid: other.huuid },
      });
      await notifyRootAuthorityOfDuplicate(result.huuid, other.huuid, 'same government document');
      return NextResponse.json({ received: true }); // do not upgrade tier
    }
  }

  // Smile Secure: same face already enrolled under a different HUUID.
  if (result.duplicateFace.duplicateFound) {
    const matchedSmileUserId = result.duplicateFace.matchedUserIds[0];
    const { data: matchRows } = matchedSmileUserId
      ? await client.rpc('huuid_find_patient_by_smile_reference', { p_smile_reference: matchedSmileUserId })
      : { data: null };
    const matched = (Array.isArray(matchRows) ? matchRows[0] : matchRows) as { huuid: string } | undefined;
    if (matched && matched.huuid !== result.huuid) {
      await client.rpc('huuid_flag_potential_duplicate', {
        p_huuid: result.huuid,
        p_duplicate_of_huuid: matched.huuid,
        p_pms_score: 0.95, // Smile Secure same-face match -- their own ML verdict, near-certain but not literally 1.0
      });
      await client.rpc('huuid_smile_id_log_insert_result', {
        p_huuid: result.huuid,
        p_job_id: pending?.job_id ?? 'unknown',
        p_job_type: result.product,
        p_smile_reference: smileUserId,
        p_document_type: pending?.document_type ?? null,
        p_document_country: pending?.document_country ?? null,
        p_result_code: 'DUPLICATE_FACE',
        p_result_text: `Face already registered to ${matched.huuid}`,
        p_confidence_value: null,
        p_duplicate_reference: matched.huuid,
        p_raw_response: payload,
      });
      await writeEnrollmentAudit({
        huuid: result.huuid,
        action: 'duplicate_document_detected',
        ipHash: SYSTEM_ACTOR_HASH,
        userAgentHash: SYSTEM_ACTOR_HASH,
        outcome: 'flagged_same_face',
        details: { duplicate_of_huuid: matched.huuid },
      });
      await notifyRootAuthorityOfDuplicate(result.huuid, matched.huuid, 'same face (Smile Secure)');
      return NextResponse.json({ received: true }); // do not upgrade tier
    }
  }

  // All checks passed.
  const biometricCommitmentHash = createHash('sha256')
    .update(`${smileUserId ?? pending?.job_id ?? result.huuid}:${result.huuid}`)
    .digest('hex');

  await client.rpc('huuid_complete_smile_id_verification', {
    p_huuid: result.huuid,
    p_biometric_commitment_hash: biometricCommitmentHash,
    p_document_type: pending?.document_type ?? 'unknown',
    p_document_country: pending?.document_country ?? 'unknown',
    p_smile_job_id: pending?.job_id ?? 'unknown',
    p_smile_id_smile_reference: smileUserId ?? '',
  });

  await client.rpc('huuid_smile_id_log_insert_result', {
    p_huuid: result.huuid,
    p_job_id: pending?.job_id ?? 'unknown',
    p_job_type: result.product,
    p_smile_reference: smileUserId,
    p_document_type: pending?.document_type ?? null,
    p_document_country: pending?.document_country ?? null,
    p_result_code: '0000',
    p_result_text: result.message,
    p_confidence_value: null,
    p_duplicate_reference: null,
    p_raw_response: payload,
  });

  await writeEnrollmentAudit({
    huuid: result.huuid,
    action: 'identity_verified_smile_id',
    ipHash: SYSTEM_ACTOR_HASH,
    userAgentHash: SYSTEM_ACTOR_HASH,
    outcome: 'success',
  });

  return NextResponse.json({ received: true });
}

async function notifyPatientOfTier2Upgrade(client: ReturnType<typeof getServiceClient>, huuid: string): Promise<void> {
  const { data: profileRows } = await client.rpc('huuid_get_patient_profile', { p_huuid: huuid, p_pii_key: getPiiKey() });
  const profile = (Array.isArray(profileRows) ? profileRows[0] : profileRows) as { phone: string } | undefined;
  if (!profile?.phone) return;
  try {
    await sendSMS(
      profile.phone,
      'HUUID IDENTITY VERIFIED\n\nYour Healthcare Identity has been verified in person.\n\nYour HUUID is now Tier 2 -- Facility Verified. You now have full access to the HUUID network.\n\nHUUID',
      'normal'
    );
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'smile_id_callback_tier2_sms_failed', message: reason }));
  }
}

async function notifyRootAuthorityOfDuplicate(newHuuid: string, existingHuuid: string, reason: string): Promise<void> {
  const rootPhone = process.env.HUUID_ROOT_AUTHORITY_PHONE;
  if (!rootPhone) return;
  try {
    await sendSMS(
      rootPhone,
      `DUPLICATE IDENTITY DETECTED (${reason})\nNew HUUID: ${newHuuid}\nMatches existing: ${existingHuuid}\nReview in HUUID admin dashboard.\nHUUID`,
      'normal'
    );
  } catch (err) {
    const reasonText = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'smile_id_callback_root_authority_sms_failed', message: reasonText }));
  }
}
