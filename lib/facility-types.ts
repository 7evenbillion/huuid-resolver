/**
 * Client-safe facility type/EMR system value lists + labels. Split out of
 * facility-schemas.ts because that file imports lib/pii.ts ('server-only')
 * for isValidE164 — pulling FACILITY_TYPE_LABELS from it into a 'use
 * client' component drags server-only in with it and breaks the build
 * (same reason components/enroll/EnrollmentForm.tsx never imports
 * enrollment-schemas.ts directly).
 */

export const FACILITY_TYPE_LABELS = {
  teaching_hospital: '🏥 Teaching Hospital',
  regional_hospital: '🏨 Regional Hospital',
  district_hospital: '🏪 District Hospital',
  clinic: '🩺 Clinic / Health Centre',
  laboratory: '🧪 Laboratory',
  pharmacy: '💊 Pharmacy',
  imaging_center: '📷 Imaging Centre',
  specialist_center: '👨‍⚕️ Specialist Centre',
  other: '❓ Other',
} as const;

export const EMR_SYSTEM_LABELS = {
  epic: 'Epic',
  cerner: 'Cerner / Oracle Health',
  openemrs: 'OpenMRS',
  bahmni: 'Bahmni',
  meditech: 'MEDITECH',
  custom: 'Custom System',
  paper: 'Paper-Based Records',
  other: 'Other',
} as const;

export type FacilityType = keyof typeof FACILITY_TYPE_LABELS;
export type EmrSystem = keyof typeof EMR_SYSTEM_LABELS;

export const FACILITY_TYPE_VALUES = Object.keys(FACILITY_TYPE_LABELS) as FacilityType[];
export const EMR_SYSTEM_VALUES = Object.keys(EMR_SYSTEM_LABELS) as EmrSystem[];
