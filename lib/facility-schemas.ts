import { z } from 'zod';
import { isValidE164 } from '@/lib/pii';
import { FACILITY_TYPE_VALUES, EMR_SYSTEM_VALUES, type FacilityType, type EmrSystem } from '@/lib/facility-types';

export const facilityTypeEnum = z.enum(FACILITY_TYPE_VALUES as [FacilityType, ...FacilityType[]]);
export const emrSystemEnum = z.enum(EMR_SYSTEM_VALUES as [EmrSystem, ...EmrSystem[]]);

/** POST /api/facilities/register (Layer 2). */
export const facilityApplicationSchema = z.object({
  facilityName: z.string().trim().min(2).max(300),
  facilityType: facilityTypeEnum,
  countryCode: z.string().length(2),
  region: z.string().trim().min(1).max(200),
  physicalAddress: z.string().trim().min(1).max(1000),
  governmentRegistrationNumber: z.string().trim().min(1).max(200),

  emrSystem: emrSystemEnum,
  estimatedDailyPatients: z.coerce.number().int().min(0).max(1_000_000),

  authorisedSignatoryName: z.string().trim().min(1).max(200),
  authorisedSignatoryRole: z.string().trim().min(1).max(200),
  authorisedSignatoryPhone: z.string().refine(isValidE164, 'Phone number must be in E.164 format.'),
  authorisedSignatoryEmail: z.string().trim().email().optional().nullable(),

  itContactName: z.string().trim().min(1).max(200),
  itContactPhone: z.string().refine(isValidE164, 'Phone number must be in E.164 format.'),

  declarationAccepted: z.literal(true),
});

export type FacilityApplicationInput = z.infer<typeof facilityApplicationSchema>;
