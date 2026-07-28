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

/** Screen "Emergency Medical Profile" (Phase 2A). Every field optional and
 * patient-provided, not clinically verified — same Tier 1 trust level as
 * the rest of self-enrolled data. */
const allergySchema = z.object({
  substance: z.string().trim().min(1).max(200),
  reaction: z.string().trim().max(300).optional().nullable(),
  severity: z.enum(['mild', 'moderate', 'severe', 'life-threatening']).optional().nullable(),
});

const medicationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  dose: z.string().trim().max(100).optional().nullable(),
  frequency: z.string().trim().max(100).optional().nullable(),
});

const contraindicationSchema = z.object({
  substance: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(300).optional().nullable(),
  severity: z.enum(['never', 'avoid', 'consult']),
});

export const bloodTypeEnum = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown']);

export const medicalProfileSchema = z.object({
  bloodType: bloodTypeEnum.optional().nullable(),
  allergies: z.array(allergySchema).max(5).optional(),
  medications: z.array(medicationSchema).max(5).optional(),
  chronicConditions: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  pregnancyStatus: z.enum(['pregnant', 'not_pregnant', 'unknown']).optional().nullable(),
  organDonor: z.enum(['yes', 'no', 'unknown']).optional().nullable(),
  implantedDevices: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  primaryPhysicianName: z.string().trim().max(200).optional().nullable(),
  primaryPhysicianPhone: z.string().trim().max(50).optional().nullable(),
  primaryFacilityName: z.string().trim().max(200).optional().nullable(),
  primaryFacilityCountry: z.string().trim().max(100).optional().nullable(),
  contraindications: z.array(contraindicationSchema).max(10).optional(),
});

export type MedicalProfileInput = z.infer<typeof medicalProfileSchema>;

/** Mirrors huuid_update_medical_profile's v_completed logic (migration 018) so the API can report completion without a second round trip. */
export function isMedicalProfileComplete(input: MedicalProfileInput): boolean {
  return (!!input.bloodType && input.bloodType !== 'unknown') || (input.allergies?.length ?? 0) >= 1;
}
