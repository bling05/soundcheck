import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import { SECURITY_HEADERS } from './src/server/csp';

// The worker and the site share one .env at the repo root, but Next.js only looks in its
// own folder. Settings already in the environment, like a host's, are never replaced.
const ROOT_ENV = path.resolve(process.cwd(), '../../.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

const nextConfig: NextConfig = {
  // Stops `next dev` from writing an AGENTS.md. Agent guidance lives in the root CLAUDE.md.
  agentRules: false,
  // Don't announce the framework in every response.
  poweredByHeader: false,
  // The Content-Security-Policy is set per page load in src/proxy.ts, because it needs a nonce.
  headers: async () => [{ source: '/:path*', headers: SECURITY_HEADERS }],
  transpilePackages: [
    '@soundcheck/db',
    '@soundcheck/report',
    '@soundcheck/shared',
  ],
};

export default nextConfig;
