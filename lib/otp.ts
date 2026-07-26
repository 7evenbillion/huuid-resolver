import 'server-only';
import { createHash, webcrypto } from 'node:crypto';

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_LOCKOUT_MINUTES = 15;
export const OTP_MAX_REQUESTS_PER_HOUR = 3;

/**
 * 6-digit numeric OTP, CSPRNG-backed (webcrypto.getRandomValues — the
 * server-side equivalent of the spec's window.crypto.getRandomValues
 * formula; there is no window in a Next.js API route).
 */
export function generateOtp(): string {
  const buf = new Uint32Array(1);
  webcrypto.getRandomValues(buf);
  const n = Math.floor((buf[0] / 4294967296) * 1_000_000);
  return n.toString().padStart(OTP_LENGTH, '0');
}

/** OTPs are never stored or logged raw — only this hash. */
export function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

export function otpMessage(code: string): string {
  return `Your HUUID verification code is: ${code}\nValid for ${OTP_EXPIRY_MINUTES} minutes.\nDo not share this code with anyone.\nHUUID Healthcare Identity`;
}
