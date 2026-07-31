import 'server-only';
import { makeEncryptedCookieSession, type TimestampedPayload } from '@/lib/encrypted-cookie';

export interface EnrollmentSessionData extends TimestampedPayload {
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
  sexAtBirth: 'male' | 'female' | 'intersex';
  countryCode: string;
  phone: string; // E.164
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  consentIpHash: string;
  phoneVerified: boolean;
  /** Set only when this enrollment was started from /facility/enroll
   * (Layer 7 — a staff member enrolling a patient at their facility).
   * When present, /api/enroll/register links the resulting HUUID to
   * this facility (huuid_identity_map_registry, link_method
   * 'facility_enrollment') once registration succeeds. */
  witnessingFacilityDid?: string | null;
}

const SESSION_MAX_AGE_SECONDS = 30 * 60; // 30 minutes — enrollment is a short flow

export const enrollmentSession = makeEncryptedCookieSession<EnrollmentSessionData>({
  cookieName: 'huuid_enroll_session',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
});
