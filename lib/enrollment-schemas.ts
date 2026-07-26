import { z } from 'zod';
import { isValidE164 } from '@/lib/pii';

/** Screen 1 — enrollment form (CLAUDE.md Rule 17: Zod on every form input). */
export const enrollmentStartSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD.')
    .refine((v) => {
      const d = new Date(v);
      return !Number.isNaN(d.getTime()) && d <= new Date() && d >= new Date('1900-01-01');
    }, 'Date of birth must be between 1900-01-01 and today.'),
  sexAtBirth: z.enum(['male', 'female', 'intersex']),
  countryCode: z.string().length(2),
  phone: z.string().refine(isValidE164, 'Phone number must be in E.164 format (e.g. +233241234567).'),
  email: z.string().trim().email().optional().nullable(),
  emergencyContactName: z.string().trim().max(200).optional().nullable(),
  emergencyContactPhone: z
    .string()
    .refine((v) => !v || isValidE164(v), 'Emergency contact phone must be in E.164 format.')
    .optional()
    .nullable(),
  consentTerms: z.literal(true),
  consentDataProcessing: z.literal(true),
});

export type EnrollmentStartInput = z.infer<typeof enrollmentStartSchema>;

export const verifyOtpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits.'),
});

export const registerSchema = z.object({
  huuid: z.string().regex(/^did:huuid:[a-z]{2}:[1-9A-HJ-NP-Za-km-z]+$/, 'Malformed HUUID.'),
  did_document: z.record(z.string(), z.unknown()),
  encrypted_private_key: z.string().min(1),
  pbkdf2_salt: z.string().min(1),
  pbkdf2_iv: z.string().min(1),
  webauthn_credential_id: z.string().optional().nullable(),
});

export const recoverStartSchema = z.object({
  phone: z.string().refine(isValidE164, 'Phone number must be in E.164 format.'),
});
