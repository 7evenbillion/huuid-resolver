import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPiiKey } from '@/lib/pii';
import { buildQrTokenPayload, signQrToken, type MedicalProfileForToken } from '@/lib/qr-token';

interface ProfileRow {
  full_name: string;
  country_code: string;
}

interface MedicalRow {
  blood_type: string | null;
  allergies: unknown;
  medications: unknown;
  chronic_conditions: unknown;
  pregnancy_status: string | null;
  organ_donor: string | null;
  implanted_devices: unknown;
  primary_facility_name: string | null;
  contraindications: unknown;
  medical_profile_completed: boolean;
  medical_profile_updated_at: string | null;
}

export interface MyHuuidCardData {
  huuid: string;
  fullName: string;
  countryCode: string;
  qrToken: string | null;
  qrTokenUsingInterimKey: boolean | null;
  qrTokenGeneratedAt: number | null;
  qrTokenExpiresAt: number | null;
  cardTokenGeneratedAt: string | null;
  medicalProfileUpdatedAt: string | null;
  medicalProfileCompleted: boolean;
  medical: {
    bloodType: string | null;
    allergies: { substance: string; reaction?: string | null; severity?: string | null }[];
    chronicConditions: string[];
    implantedDevices: string[];
    organDonor: string | null;
    pregnancyStatus: string | null;
    contraindications: { substance: string; reason?: string | null; severity: 'never' | 'avoid' | 'consult' }[];
  };
}

/** Shared by GET /api/my-huuid/card (view) and POST /api/my-huuid/refresh-card
 * (regenerate + bump card_token_generated_at) -- both need the same
 * patient/medical lookup and the same freshly-signed QR token, since
 * lib/qr-token.ts never persists a token, only builds one on demand. */
export async function loadCardData(client: SupabaseClient, huuid: string): Promise<MyHuuidCardData | null> {
  const piiKey = getPiiKey();

  const [{ data: profileData }, { data: medicalData }, { data: patientRow }] = await Promise.all([
    client.rpc('huuid_get_patient_profile', { p_huuid: huuid, p_pii_key: piiKey }).maybeSingle(),
    client.rpc('huuid_get_medical_profile', { p_huuid: huuid, p_pii_key: piiKey }).maybeSingle(),
    client.from('huuid_patients').select('card_token_generated_at').eq('huuid', huuid).maybeSingle(),
  ]);

  const profile = profileData as ProfileRow | null;
  if (!profile) return null;
  const medical = (medicalData as MedicalRow | null) ?? null;

  const medicalForToken: MedicalProfileForToken = {
    bloodType: medical?.blood_type ?? null,
    allergies: (medical?.allergies as MedicalProfileForToken['allergies']) ?? [],
    medications: (medical?.medications as MedicalProfileForToken['medications']) ?? [],
    chronicConditions: (medical?.chronic_conditions as string[]) ?? [],
    organDonor: medical?.organ_donor ?? null,
    implantedDevices: (medical?.implanted_devices as string[]) ?? [],
    pregnancyStatus: medical?.pregnancy_status ?? null,
    primaryFacilityName: medical?.primary_facility_name ?? null,
    contraindications: (medical?.contraindications as MedicalProfileForToken['contraindications']) ?? [],
  };

  const payload = buildQrTokenPayload(huuid, medicalForToken);
  const signed = signQrToken(payload);

  return {
    huuid,
    fullName: profile.full_name,
    countryCode: profile.country_code,
    qrToken: signed?.token ?? null,
    qrTokenUsingInterimKey: signed?.usingInterimKey ?? null,
    qrTokenGeneratedAt: payload.gen,
    qrTokenExpiresAt: payload.exp,
    cardTokenGeneratedAt: (patientRow?.card_token_generated_at as string | null) ?? null,
    medicalProfileUpdatedAt: medical?.medical_profile_updated_at ?? null,
    medicalProfileCompleted: medical?.medical_profile_completed ?? false,
    medical: {
      bloodType: medical?.blood_type ?? null,
      allergies: (medical?.allergies as MyHuuidCardData['medical']['allergies']) ?? [],
      chronicConditions: (medical?.chronic_conditions as string[]) ?? [],
      implantedDevices: (medical?.implanted_devices as string[]) ?? [],
      organDonor: medical?.organ_donor ?? null,
      pregnancyStatus: medical?.pregnancy_status ?? null,
      contraindications: (medical?.contraindications as MyHuuidCardData['medical']['contraindications']) ?? [],
    },
  };
}
