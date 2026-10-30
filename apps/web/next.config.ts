import type { NextConfig } from 'next';

const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Lets a second copy (e.g. automated browser tests) run next to your own `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // @yucampus/ui ships TypeScript source; Next compiles it with the app.
  transpilePackages: ['@yucampus/ui'],

  // The browser talks to /api/v1 on the web origin and Next forwards it to the API. Same origin means the
  // httpOnly refresh cookie just works on every college subdomain, with no cross-site cookie rules to fight.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_TARGET}/api/v1/:path*` }];
  },
};

export default nextConfig;
