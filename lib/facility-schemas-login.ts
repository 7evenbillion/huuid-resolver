import { z } from 'zod';

export const facilityLoginStartSchema = z.object({
  facilityDid: z.string().regex(/^did:huuid:[a-z]{2}:[1-9A-HJ-NP-Za-km-z]+$/, 'Malformed Facility ID.'),
});

export const facilityLoginVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits.'),
});
