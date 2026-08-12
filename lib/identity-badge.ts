/**
 * Dedup Layer 7 — shared tier-badge/method-label logic for /my-huuid's
 * home dashboard and settings identity section. Pure and framework-
 * agnostic (no 'server-only') since both a server component (home page)
 * and a client component (settings page, fed by an API response) need
 * it.
 */

export type TierBadgeColor = 'grey' | 'blue' | 'green' | 'gold';

export interface TierBadgeInfo {
  emoji: string;
  label: string;
  color: TierBadgeColor;
}

/** verification_tier=2/3 already implies identity_verified=true at the
 * database level (huuid_complete_tier2_upgrade sets both together), but
 * identityVerified is still taken as an explicit input rather than
 * inferred, so this stays correct even if a future tier is reached by a
 * path that sets them separately. */
export function getTierBadge(verificationTier: number, identityVerified: boolean): TierBadgeInfo {
  if (verificationTier >= 3) {
    return { emoji: '⭐', label: 'Government Verified', color: 'gold' };
  }
  if (verificationTier === 2) {
    return { emoji: '🟢', label: 'Fully Verified', color: 'green' };
  }
  if (identityVerified) {
    return { emoji: '🔵', label: 'Document Verified', color: 'blue' };
  }
  return { emoji: '🔘', label: 'Basic Enrollment', color: 'grey' };
}

const METHOD_LABELS: Record<string, string> = {
  smile_id_document_face: 'Document + selfie match (Smile ID)',
  facility_in_person: 'Facility staff (in person)',
};

export function identityMethodLabel(method: string | null): string {
  if (!method) return 'Not verified';
  return METHOD_LABELS[method] ?? method;
}
