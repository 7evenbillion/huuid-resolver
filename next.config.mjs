/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // W3C DID Resolution mandates GET /1.0/identifiers/{did} at the root.
    // The handler lives at /api/1.0/identifiers/[did]; this rewrite exposes
    // the spec-compliant path without duplicating the route.
    return [
      {
        source: '/1.0/identifiers/:did',
        destination: '/api/1.0/identifiers/:did',
      },
    ];
  },
};

export default nextConfig;
