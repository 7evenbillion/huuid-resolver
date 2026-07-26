import 'server-only';
import { cookies } from 'next/headers';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Generic AES-256-GCM encrypted httpOnly cookie session, shared by the
 * enrollment and recovery flows. No third-party session library — same
 * hand-rolled-crypto convention already used elsewhere in this repo
 * (lib/facility-jwt.ts, lib/canonical-json.ts). Encrypted, not just
 * signed, because these payloads carry PII in transit between screens.
 */

function deriveKey(envVarName: string): Buffer {
  const secret = process.env[envVarName];
  if (!secret || secret.length < 32) {
    throw new Error(`${envVarName} is missing or too short (minimum 32 characters).`);
  }
  return createHash('sha256').update(secret).digest();
}

function encrypt<T>(payload: T, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
}

function decrypt<T>(token: string, key: Buffer): T | null {
  try {
    const raw = Buffer.from(token, 'base64url');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export interface EncryptedCookieConfig {
  cookieName: string;
  envVarName: string;
  maxAgeSeconds: number;
}

export interface TimestampedPayload {
  createdAt: number;
}

export function makeEncryptedCookieSession<T extends TimestampedPayload>(
  config: EncryptedCookieConfig
) {
  return {
    async set(data: T): Promise<void> {
      const store = await cookies();
      store.set(config.cookieName, encrypt(data, deriveKey(config.envVarName)), {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: config.maxAgeSeconds,
      });
    },
    async get(): Promise<T | null> {
      const store = await cookies();
      const token = store.get(config.cookieName)?.value;
      if (!token) return null;
      const data = decrypt<T>(token, deriveKey(config.envVarName));
      if (!data) return null;
      if (Date.now() - data.createdAt > config.maxAgeSeconds * 1000) return null;
      return data;
    },
    async update(patch: Partial<T>): Promise<void> {
      const current = await this.get();
      if (!current) throw new Error(`No active ${config.cookieName} session.`);
      await this.set({ ...current, ...patch });
    },
    async clear(): Promise<void> {
      const store = await cookies();
      store.delete(config.cookieName);
    },
  };
}
