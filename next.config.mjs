/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // W3C DID Resolution mandates GET /1.0/identifiers/{did} at the root.
    // The handler lives at /api/1.0/identifiers/[did]; this rewrite exposes
    // the spec-compliant path without duplicating the route. Break-Glass
    // (the protocol's only POST) gets the same treatment at its own path.
    return [
      {
        source: '/1.0/identifiers/:did',
        destination: '/api/1.0/identifiers/:did',
      },
      {
        source: '/1.0/identifiers/:did/break-glass',
        destination: '/api/1.0/identifiers/:did/break-glass',
      },
      {
        source: '/1.0/stub-integrity',
        destination: '/api/1.0/stub-integrity',
      },
      {
        source: '/1.0/resolver-public-key',
        destination: '/api/1.0/resolver-public-key',
      },
    ];
  },
};

export default nextConfig;
