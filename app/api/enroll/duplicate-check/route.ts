import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { enrollmentSession } from '@/lib/enrollment-session';
import { computePmsScore, isNameDobSimilar, maskHuuid } from '@/lib/dedup-scoring';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DobCandidateRow {
  huuid: string;
  full_name: string;
  verification_tier: number;
  enrolling_facility_did: string | null;
  created_at: string;
}

/**
 * POST /api/enroll/duplicate-check — dedup Layer 2. Called by the client
 * right after /api/enroll/verify-otp succeeds, before navigating to
 * /enroll/secure. Runs the T5 (name/DOB) signal only -- no biometric
 * (T1) exists at this point in the flow, so the PMS score computed here
 * can never itself cross the human_review threshold (max without T1 is
 * 0.20+0.10+0.10 = 0.40); it's stored for Layer 4 to build on once a
 * biometric commitment hash exists, not to gate anything today. What
 * DOES gate today is the T5 name-similarity flag: found -> interstitial
 * warning, exactly per the build prompt's Layer 2 Step D UI.
 *
 * Document-hash duplicate blocking (the build prompt's Layer 2 Step B) is
 * NOT implemented here -- no document has been captured yet at this
 * point in self-enrollment (that only happens at the Layer 3
 * /enroll/verify-identity step, after /enroll/secure). Real enforcement
 * belongs in the Layer 4 Smile ID callback handler, where a document
 * hash first becomes available.
 */
export async function POST() {
  const session = await enrollmentSession.get();
  if (!session) {
    return NextResponse.json({ error: 'Your enrollment session has expired. Please start again.' }, { status: 400 });
  }
  if (!session.phoneVerified) {
    return NextResponse.json({ error: 'Phone number is not verified.' }, { status: 400 });
  }

  const client = getServiceClient();
  const piiKey = getPiiKey();

  const { data: dobHashRows, error: hashError } = await client.rpc('huuid_hash_dob', {
    p_dob: session.dateOfBirth,
    p_pii_key: piiKey,
  });
  if (hashError) {
    console.error(JSON.stringify({ level: 'error', action: 'duplicate_check_hash_failed', message: hashError.message }));
    return NextResponse.json({ error: 'Could not process your request. Please try again.' }, { status: 500 });
  }
  const dobHash = (Array.isArray(dobHashRows) ? dobHashRows[0] : dobHashRows) as string;

  const { data: candidateRows, error: candidatesError } = await client.rpc('huuid_find_dob_candidates', {
    p_dob_hash: dobHash,
    p_pii_key: piiKey,
    p_exclude_huuid: null,
  });
  if (candidatesError) {
    console.error(
      JSON.stringify({ level: 'error', action: 'duplicate_check_candidates_failed', message: candidatesError.message })
    );
    return NextResponse.json({ error: 'Could not process your request. Please try again.' }, { status: 500 });
  }

  const candidates = (candidateRows ?? []) as DobCandidateRow[];
  const similar = candidates.filter((c) => isNameDobSimilar(c.full_name, session.fullName));

  if (similar.length === 0) {
    await enrollmentSession.update({
      duplicateCandidateHuuid: null,
      duplicateCandidateMaskedHuuid: null,
      duplicatePmsScore: null,
    });
    return NextResponse.json({ potentialDuplicate: false });
  }

  // Most recently enrolled similar candidate -- an arbitrary but
  // reasonable tie-break; the admin duplicates panel (Layer 6) is where a
  // human actually resolves ambiguity, this only decides what the
  // enrollment-time interstitial shows.
  const best = similar.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));

  const daysSinceCandidate = Math.abs(Date.now() - new Date(best.created_at).getTime()) / (1000 * 60 * 60 * 24);
  const { score } = computePmsScore({
    biometricCommitmentMatch: false, // T1 unavailable at this stage -- see module comment
    sameIssuingFacility: Boolean(session.witnessingFacilityDid) && session.witnessingFacilityDid === best.enrolling_facility_did,
    enrollmentProximityDays: daysSinceCandidate,
    guardianLinkPresented: false, // T4 -- see lib/dedup-scoring.ts header
  });

  const maskedHuuid = maskHuuid(best.huuid);
  await enrollmentSession.update({
    duplicateCandidateHuuid: best.huuid,
    duplicateCandidateMaskedHuuid: maskedHuuid,
    duplicatePmsScore: score,
  });

  return NextResponse.json({ potentialDuplicate: true, maskedHuuid });
}

/** GET /api/enroll/duplicate-check — the interstitial page's own data fetch, matching /api/enroll/session-status's pattern (never pass PII/identifiers through URL params between routes). */
export async function GET() {
  const session = await enrollmentSession.get();
  if (!session) {
    return NextResponse.json({ error: 'No active enrollment session.' }, { status: 400 });
  }
  return NextResponse.json({
    potentialDuplicate: Boolean(session.duplicateCandidateHuuid),
    maskedHuuid: session.duplicateCandidateMaskedHuuid ?? null,
  });
}
