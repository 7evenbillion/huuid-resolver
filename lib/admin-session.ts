import 'server-only';
import { makeEncryptedCookieSession, type TimestampedPayload } from '@/lib/encrypted-cookie';

/** Root Authority admin session — 8 hours (longer than patient/enrollment
 * sessions since admin tasks like reviewing applications take time). */
export interface AdminSessionData extends TimestampedPayload {
  phone: string;
}

const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export const adminSession = makeEncryptedCookieSession<AdminSessionData>({
  cookieName: 'huuid_admin_session',
  envVarName: 'HUUID_ADMIN_SESSION_SECRET',
  maxAgeSeconds: ADMIN_SESSION_MAX_AGE_SECONDS,
});

/** Short-lived pending-OTP challenge, set by /api/admin/login/start and
 * consumed by /api/admin/login/verify. Stateless (encrypted cookie, not a
 * DB table) since there is exactly one admin phone (HUUID_ROOT_AUTHORITY_PHONE)
 * and no patient-style record to attach an OTP row to. */
export interface AdminOtpChallengeData extends TimestampedPayload {
  otpHash: string;
  phone: string;
}

const ADMIN_OTP_MAX_AGE_SECONDS = 10 * 60;

export const adminOtpChallenge = makeEncryptedCookieSession<AdminOtpChallengeData>({
  cookieName: 'huuid_admin_otp_challenge',
  envVarName: 'HUUID_ADMIN_SESSION_SECRET',
  maxAgeSeconds: ADMIN_OTP_MAX_AGE_SECONDS,
});
