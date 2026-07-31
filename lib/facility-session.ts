import 'server-only';
import { makeEncryptedCookieSession, type TimestampedPayload } from '@/lib/encrypted-cookie';

/** Facility staff dashboard session (Layer 5) — 8 hours, matching a
 * clinical shift (same reasoning as admin's 8h session, longer than the
 * 30-minute patient/enrollment sessions since staff stay logged in
 * through a working day). */
export interface FacilitySessionData extends TimestampedPayload {
  facilityDid: string;
  facilityName: string;
}

const FACILITY_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export const facilitySession = makeEncryptedCookieSession<FacilitySessionData>({
  cookieName: 'huuid_facility_session',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: FACILITY_SESSION_MAX_AGE_SECONDS,
});

/** Short-lived pending-OTP challenge for facility login, set by
 * /api/facility/login/start and consumed by /api/facility/login/verify. */
export interface FacilityOtpChallengeData extends TimestampedPayload {
  otpHash: string;
  facilityDid: string;
  facilityName: string;
}

const FACILITY_OTP_MAX_AGE_SECONDS = 10 * 60;

export const facilityOtpChallenge = makeEncryptedCookieSession<FacilityOtpChallengeData>({
  cookieName: 'huuid_facility_otp_challenge',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: FACILITY_OTP_MAX_AGE_SECONDS,
});
