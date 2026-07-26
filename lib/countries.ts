/**
 * Country list for the enrollment form's country-of-residence selector.
 * Sorted Ghana first, then Nigeria, Kenya, South Africa, then
 * alphabetical — per the enrollment spec. Flags are generated from the
 * ISO code via Unicode regional indicator symbols rather than hand-typed
 * emoji, so there's no risk of a copy-paste mismatch between a country's
 * code and its flag.
 *
 * Coverage note: this is a substantial (~100 country) list covering every
 * African nation plus the major countries of every other region — not a
 * hand-verified, exhaustive list of all 249 ISO 3166-1 entries. Adding a
 * missing country is a one-line addition to COUNTRIES below.
 */

export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  dialCode: string; // E.164 country calling code, with leading +
}

function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

const PRIORITY_CODES = ['GH', 'NG', 'KE', 'ZA'];

const ALL_COUNTRIES: Country[] = [
  // Africa
  { code: 'GH', name: 'Ghana', dialCode: '+233' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234' },
  { code: 'KE', name: 'Kenya', dialCode: '+254' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27' },
  { code: 'DZ', name: 'Algeria', dialCode: '+213' },
  { code: 'AO', name: 'Angola', dialCode: '+244' },
  { code: 'BJ', name: 'Benin', dialCode: '+229' },
  { code: 'BW', name: 'Botswana', dialCode: '+267' },
  { code: 'BF', name: 'Burkina Faso', dialCode: '+226' },
  { code: 'BI', name: 'Burundi', dialCode: '+257' },
  { code: 'CM', name: 'Cameroon', dialCode: '+237' },
  { code: 'CV', name: 'Cabo Verde', dialCode: '+238' },
  { code: 'CF', name: 'Central African Republic', dialCode: '+236' },
  { code: 'TD', name: 'Chad', dialCode: '+235' },
  { code: 'KM', name: 'Comoros', dialCode: '+269' },
  { code: 'CD', name: 'Congo (DRC)', dialCode: '+243' },
  { code: 'CG', name: 'Congo (Republic)', dialCode: '+242' },
  { code: 'CI', name: "Côte d'Ivoire", dialCode: '+225' },
  { code: 'DJ', name: 'Djibouti', dialCode: '+253' },
  { code: 'EG', name: 'Egypt', dialCode: '+20' },
  { code: 'GQ', name: 'Equatorial Guinea', dialCode: '+240' },
  { code: 'ER', name: 'Eritrea', dialCode: '+291' },
  { code: 'SZ', name: 'Eswatini', dialCode: '+268' },
  { code: 'ET', name: 'Ethiopia', dialCode: '+251' },
  { code: 'GA', name: 'Gabon', dialCode: '+241' },
  { code: 'GM', name: 'Gambia', dialCode: '+220' },
  { code: 'GN', name: 'Guinea', dialCode: '+224' },
  { code: 'GW', name: 'Guinea-Bissau', dialCode: '+245' },
  { code: 'LS', name: 'Lesotho', dialCode: '+266' },
  { code: 'LR', name: 'Liberia', dialCode: '+231' },
  { code: 'LY', name: 'Libya', dialCode: '+218' },
  { code: 'MG', name: 'Madagascar', dialCode: '+261' },
  { code: 'MW', name: 'Malawi', dialCode: '+265' },
  { code: 'ML', name: 'Mali', dialCode: '+223' },
  { code: 'MR', name: 'Mauritania', dialCode: '+222' },
  { code: 'MU', name: 'Mauritius', dialCode: '+230' },
  { code: 'MA', name: 'Morocco', dialCode: '+212' },
  { code: 'MZ', name: 'Mozambique', dialCode: '+258' },
  { code: 'NA', name: 'Namibia', dialCode: '+264' },
  { code: 'NE', name: 'Niger', dialCode: '+227' },
  { code: 'RW', name: 'Rwanda', dialCode: '+250' },
  { code: 'ST', name: 'São Tomé and Príncipe', dialCode: '+239' },
  { code: 'SN', name: 'Senegal', dialCode: '+221' },
  { code: 'SC', name: 'Seychelles', dialCode: '+248' },
  { code: 'SL', name: 'Sierra Leone', dialCode: '+232' },
  { code: 'SO', name: 'Somalia', dialCode: '+252' },
  { code: 'SS', name: 'South Sudan', dialCode: '+211' },
  { code: 'SD', name: 'Sudan', dialCode: '+249' },
  { code: 'TZ', name: 'Tanzania', dialCode: '+255' },
  { code: 'TG', name: 'Togo', dialCode: '+228' },
  { code: 'TN', name: 'Tunisia', dialCode: '+216' },
  { code: 'UG', name: 'Uganda', dialCode: '+256' },
  { code: 'ZM', name: 'Zambia', dialCode: '+260' },
  { code: 'ZW', name: 'Zimbabwe', dialCode: '+263' },

  // Europe
  { code: 'AT', name: 'Austria', dialCode: '+43' },
  { code: 'BE', name: 'Belgium', dialCode: '+32' },
  { code: 'BG', name: 'Bulgaria', dialCode: '+359' },
  { code: 'HR', name: 'Croatia', dialCode: '+385' },
  { code: 'CY', name: 'Cyprus', dialCode: '+357' },
  { code: 'CZ', name: 'Czechia', dialCode: '+420' },
  { code: 'DK', name: 'Denmark', dialCode: '+45' },
  { code: 'EE', name: 'Estonia', dialCode: '+372' },
  { code: 'FI', name: 'Finland', dialCode: '+358' },
  { code: 'FR', name: 'France', dialCode: '+33' },
  { code: 'DE', name: 'Germany', dialCode: '+49' },
  { code: 'GR', name: 'Greece', dialCode: '+30' },
  { code: 'HU', name: 'Hungary', dialCode: '+36' },
  { code: 'IE', name: 'Ireland', dialCode: '+353' },
  { code: 'IT', name: 'Italy', dialCode: '+39' },
  { code: 'LV', name: 'Latvia', dialCode: '+371' },
  { code: 'LT', name: 'Lithuania', dialCode: '+370' },
  { code: 'LU', name: 'Luxembourg', dialCode: '+352' },
  { code: 'MT', name: 'Malta', dialCode: '+356' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31' },
  { code: 'NO', name: 'Norway', dialCode: '+47' },
  { code: 'PL', name: 'Poland', dialCode: '+48' },
  { code: 'PT', name: 'Portugal', dialCode: '+351' },
  { code: 'RO', name: 'Romania', dialCode: '+40' },
  { code: 'SK', name: 'Slovakia', dialCode: '+421' },
  { code: 'SI', name: 'Slovenia', dialCode: '+386' },
  { code: 'ES', name: 'Spain', dialCode: '+34' },
  { code: 'SE', name: 'Sweden', dialCode: '+46' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44' },

  // Americas
  { code: 'AR', name: 'Argentina', dialCode: '+54' },
  { code: 'BR', name: 'Brazil', dialCode: '+55' },
  { code: 'CA', name: 'Canada', dialCode: '+1' },
  { code: 'CL', name: 'Chile', dialCode: '+56' },
  { code: 'CO', name: 'Colombia', dialCode: '+57' },
  { code: 'MX', name: 'Mexico', dialCode: '+52' },
  { code: 'PE', name: 'Peru', dialCode: '+51' },
  { code: 'US', name: 'United States', dialCode: '+1' },
  { code: 'JM', name: 'Jamaica', dialCode: '+1876' },
  { code: 'TT', name: 'Trinidad and Tobago', dialCode: '+1868' },

  // Asia
  { code: 'CN', name: 'China', dialCode: '+86' },
  { code: 'IN', name: 'India', dialCode: '+91' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62' },
  { code: 'JP', name: 'Japan', dialCode: '+81' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92' },
  { code: 'PH', name: 'Philippines', dialCode: '+63' },
  { code: 'SG', name: 'Singapore', dialCode: '+65' },
  { code: 'KR', name: 'South Korea', dialCode: '+82' },
  { code: 'TH', name: 'Thailand', dialCode: '+66' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880' },

  // Middle East
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966' },
  { code: 'QA', name: 'Qatar', dialCode: '+974' },
  { code: 'IL', name: 'Israel', dialCode: '+972' },
  { code: 'JO', name: 'Jordan', dialCode: '+962' },
  { code: 'LB', name: 'Lebanon', dialCode: '+961' },
  { code: 'TR', name: 'Türkiye', dialCode: '+90' },

  // Oceania
  { code: 'AU', name: 'Australia', dialCode: '+61' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64' },
];

export const COUNTRIES: (Country & { flag: string })[] = (() => {
  const withFlags = ALL_COUNTRIES.map((c) => ({ ...c, flag: flagEmoji(c.code) }));
  const priority = PRIORITY_CODES
    .map((code) => withFlags.find((c) => c.code === code))
    .filter((c): c is Country & { flag: string } => Boolean(c));
  const rest = withFlags
    .filter((c) => !PRIORITY_CODES.includes(c.code))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...priority, ...rest];
})();

export function findCountry(code: string): (Country & { flag: string }) | undefined {
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}
