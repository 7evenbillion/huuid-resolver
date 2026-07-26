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
}

const SESSION_MAX_AGE_SECONDS = 30 * 60; // 30 minutes — enrollment is a short flow

export const enrollmentSession = makeEncryptedCookieSession<EnrollmentSessionData>({
  cookieName: 'huuid_enroll_session',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
});
