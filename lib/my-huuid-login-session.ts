import 'server-only';
import { makeEncryptedCookieSession, type TimestampedPayload } from '@/lib/encrypted-cookie';

/** PIN login: short-lived challenge nonce, set by
 * /api/my-huuid/login/pin/challenge, consumed by
 * /api/my-huuid/login/pin/verify. */
export interface MyHuuidPinChallengeData extends TimestampedPayload {
  huuid: string;
  nonceB64: string;
  phone: string | null;
}

const PIN_CHALLENGE_MAX_AGE_SECONDS = 5 * 60;

export const myHuuidPinChallenge = makeEncryptedCookieSession<MyHuuidPinChallengeData>({
  cookieName: 'huuid_my_huuid_pin_challenge',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: PIN_CHALLENGE_MAX_AGE_SECONDS,
});

/** Phone/OTP login: mirrors recoverySession's shape but is semantically
 * "logging in", not "recovering forgotten access" — kept separate so a
 * stale recovery session can never accidentally authenticate a login. */
export interface MyHuuidOtpLoginSessionData extends TimestampedPayload {
  phone: string;
  huuid: string;
  phoneVerified: boolean;
}

const OTP_LOGIN_SESSION_MAX_AGE_SECONDS = 10 * 60;

export const myHuuidOtpLoginSession = makeEncryptedCookieSession<MyHuuidOtpLoginSessionData>({
  cookieName: 'huuid_my_huuid_otp_login_session',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: OTP_LOGIN_SESSION_MAX_AGE_SECONDS,
});
