/**
 * Per-jurisdiction data-protection notice shown on the enrollment form
 * below the consent checkboxes. Updates dynamically if the visitor
 * changes their declared country of residence. Country selection is
 * always the visitor's own choice — geo-detection only pre-selects it.
 */

const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
]);

const NOTICES: Record<string, string> = {
  GH: 'Your personal data is processed in accordance with the Ghana Data Protection Act 2012. You have the right to access, correct and delete your personal data at any time. The Data Protection Commission of Ghana oversees compliance.',
  NG: 'Your personal data is processed in accordance with the Nigeria Data Protection Act 2023 (NDPA). You have the right to access, correct, delete and port your personal data. The Nigeria Data Protection Commission (NDPC) oversees compliance.',
  KE: 'Your personal data is processed in accordance with the Kenya Data Protection Act 2019. You have the right to access, rectification and erasure of your personal data. The Office of the Data Protection Commissioner oversees compliance.',
  ZA: 'Your personal data is processed in accordance with the Protection of Personal Information Act 2013 (POPIA). You have the right to access, correction and deletion of your personal information. The Information Regulator of South Africa oversees compliance.',
  TH: 'Your personal data is processed in accordance with the Thailand Personal Data Protection Act (PDPA). You have the right to access, rectify, erase and object to the processing of your personal data. The Personal Data Protection Committee oversees compliance.',
  US: 'Your personal data is processed in accordance with applicable US state and federal privacy laws, including HIPAA where relevant to health information. You have the right to access and request deletion of your personal data.',
  GB: 'Your personal data is processed in accordance with the UK GDPR and the Data Protection Act 2018. You have the right to access, rectification, erasure, and to object to processing. You may lodge a complaint with the Information Commissioner’s Office (ICO).',
};

const EU_NOTICE =
  'Your personal data is processed in accordance with the General Data Protection Regulation (GDPR) (EU) 2016/679. You have the right to access, rectification, erasure, restriction of processing, data portability, and to object to processing. You may lodge a complaint with your national supervisory authority.';

const DEFAULT_NOTICE =
  'Your personal data is processed in accordance with applicable data protection laws in your jurisdiction and with international privacy-by-design principles. You have the right to access, correct and request deletion of your personal data at any time. Contact josephtdnarnor@gmail.com for any data protection request.';

export function getRegulatoryNotice(countryCode: string | null | undefined): string {
  if (!countryCode) return DEFAULT_NOTICE;
  const cc = countryCode.toUpperCase();
  if (NOTICES[cc]) return NOTICES[cc];
  if (EU_COUNTRIES.has(cc)) return EU_NOTICE;
  return DEFAULT_NOTICE;
}
