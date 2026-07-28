import 'server-only';
import { makeEncryptedCookieSession, type TimestampedPayload } from '@/lib/encrypted-cookie';

/**
 * Generic phone-OTP-verified patient session (otp_type='login', already
 * anticipated by huuid_otp_verifications' check constraint before this
 * task). Intended for a future /my-huuid dashboard's login flow — no
 * /api/patient/login/start or /verify-otp route exists yet to populate this
 * cookie, so /api/patient/medical is wired against it but not reachable
 * end-to-end until that login flow is built. Kept separate from
 * eraseSession (semantically "verified to erase," not "logged in") and
 * from postEnrollmentSession (semantically "just enrolled," not a
 * returning, re-authenticated visit).
 */
export interface PatientSessionData extends TimestampedPayload {
  phone: string; // E.164
  phoneVerified: boolean;
  huuid: string;
}

const SESSION_MAX_AGE_SECONDS = 30 * 60;

export const patientSession = makeEncryptedCookieSession<PatientSessionData>({
  cookieName: 'huuid_patient_session',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
});
