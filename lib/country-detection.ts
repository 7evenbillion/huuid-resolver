import { headers } from 'next/headers';

/**
 * Vercel's built-in geo headers — available at zero cost on every Vercel
 * deployment, no third-party geo-IP service needed. Convenience only:
 * the visitor can always change the detected country manually in the
 * enrollment form. Also logged in the enrollment audit record.
 */
export interface DetectedGeo {
  country: string | null;
  city: string | null;
  region: string | null;
}

export async function detectGeo(): Promise<DetectedGeo> {
  const h = await headers();
  return {
    country: h.get('x-vercel-ip-country'),
    city: h.get('x-vercel-ip-city'),
    region: h.get('x-vercel-ip-region'),
  };
}
