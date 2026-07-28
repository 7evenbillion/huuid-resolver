import 'server-only';
import { makeEncryptedCookieSession, type TimestampedPayload } from '@/lib/encrypted-cookie';

/**
 * Bridges the gap between /api/enroll/register (which clears
 * enrollmentSession as its terminal step) and /api/enroll/medical, which
 * runs a moment later in the same sitting (ready -> medical -> card). Not
 * specified in the original enrollment spec — added because /enroll/medical
 * has no other way to prove "this browser just created this huuid" without
 * either reusing enrollmentSession (wrong shape/semantics — that session is
 * pre-registration PII, not a post-registration identity token) or forcing
 * a second OTP verification for what is still the same continuous flow.
 *
 * Deliberately separate from the phone-OTP-verified patient session used by
 * /api/patient/medical (a future, return-visit dashboard) — this one only
 * ever proves "just enrolled," never "logged in."
 */
export interface PostEnrollmentSessionData extends TimestampedPayload {
  huuid: string;
}

const SESSION_MAX_AGE_SECONDS = 30 * 60; // matches enrollmentSession's own "short flow" precedent

export const postEnrollmentSession = makeEncryptedCookieSession<PostEnrollmentSessionData>({
  cookieName: 'huuid_post_enroll_session',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
});
