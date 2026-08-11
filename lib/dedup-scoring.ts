import 'server-only';

/**
 * T1-T5 weighted patient-matching score (PMS), per HUUID-RESOLUTION-SPEC-
 * v0.3.docx Section 3.1/3.2. Operator decision 2026-08-10: this replaces
 * the flat "Levenshtein distance <= 2" duplicate check the original
 * Smile ID build prompt proposed -- that check still exists here as T5,
 * exactly as the spec requires: display/flagging only, weight 0, never
 * contributes to the automated score.
 *
 * T4 (guardian-link cross-reference) is always 0 -- no guardian-
 * registration feature exists anywhere in this codebase yet (see
 * migration 036's header comment). Structurally present so wiring it up
 * later is a scoring-input change, not a rewrite.
 */

export const PMS_WEIGHTS = {
  t1BiometricCommitment: 0.6,
  t2IssuingFacility: 0.2,
  t3EnrollmentProximity: 0.1,
  t4GuardianLink: 0.1,
  t5NameDob: 0,
} as const;

export const PMS_AUTO_RESOLVE_THRESHOLD = 0.92;
export const PMS_HUMAN_REVIEW_THRESHOLD = 0.75;

/** T3: "same patient rarely enrolls twice within 90 days at different nodes" (spec's own wording). */
const T3_PROXIMITY_WINDOW_DAYS = 90;
/** T5's own note: fallback display only. Distance <= 2 catches typos/transliteration variants without over-matching common names. */
const T5_MAX_LEVENSHTEIN_DISTANCE = 2;

export type PmsVerdict = 'auto_resolve' | 'human_review' | 'new_huuid';

export interface PmsMatchSignals {
  /** T1: does the new enrollment's biometric_commitment_hash equal this candidate's? */
  biometricCommitmentMatch: boolean;
  /** T2: same enrolling_facility_did, both non-null. */
  sameIssuingFacility: boolean;
  /** T3: days between the two enrollments' created_at, or null if unknown. */
  enrollmentProximityDays: number | null;
  /** T4: guardian HUUID presented and cross-referenced. Always false today -- see module header. */
  guardianLinkPresented: boolean;
}

export interface PmsScoreResult {
  score: number;
  verdict: PmsVerdict;
  breakdown: Record<keyof typeof PMS_WEIGHTS, number>;
}

export function computePmsScore(signals: PmsMatchSignals): PmsScoreResult {
  const t1 = signals.biometricCommitmentMatch ? PMS_WEIGHTS.t1BiometricCommitment : 0;
  const t2 = signals.sameIssuingFacility ? PMS_WEIGHTS.t2IssuingFacility : 0;
  const t3 =
    signals.enrollmentProximityDays !== null && signals.enrollmentProximityDays <= T3_PROXIMITY_WINDOW_DAYS
      ? PMS_WEIGHTS.t3EnrollmentProximity
      : 0;
  const t4 = signals.guardianLinkPresented ? PMS_WEIGHTS.t4GuardianLink : 0;
  // T5 weight is 0 by design (spec SS3.1) -- it never contributes to the
  // automated score, only to human-review display (isNameDobSimilar below).
  const t5 = 0;

  const score = t1 + t2 + t3 + t4 + t5;
  const verdict: PmsVerdict =
    score >= PMS_AUTO_RESOLVE_THRESHOLD ? 'auto_resolve' : score >= PMS_HUMAN_REVIEW_THRESHOLD ? 'human_review' : 'new_huuid';

  return {
    score,
    verdict,
    breakdown: {
      t1BiometricCommitment: t1,
      t2IssuingFacility: t2,
      t3EnrollmentProximity: t3,
      t4GuardianLink: t4,
      t5NameDob: t5,
    },
  };
}

/** Standard DP Levenshtein distance. Small inputs (person names) -- O(n*m) is fine, no library dependency needed. */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** lowercase, trim, collapse whitespace, strip common titles -- matches the original prompt's normalise() spec exactly. */
export function normalizeNameForMatching(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|dr|prof)\.?\b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** T5 signal: used only to decide whether to flag/display a candidate for human review, never fed into computePmsScore's score. */
export function isNameDobSimilar(candidateName: string, newName: string): boolean {
  const distance = levenshteinDistance(normalizeNameForMatching(candidateName), normalizeNameForMatching(newName));
  return distance <= T5_MAX_LEVENSHTEIN_DISTANCE;
}
