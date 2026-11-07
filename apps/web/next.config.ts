import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import { SECURITY_HEADERS } from './src/server/csp';

const REPO_ROOT = path.resolve(process.cwd(), '../..');

// Settings live in one .env at the repo root, shared with scripts like db:migrate, but
// Next.js only looks in its own folder. Settings already in the environment, like a host's, are never replaced.
const ROOT_ENV = path.join(REPO_ROOT, '.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

const nextConfig: NextConfig = {
  // This is one app in a monorepo. Packages are installed once at the repo root, so the
  // build must look there, and the deployed site must include files from there, like `pg`.
  outputFileTracingRoot: REPO_ROOT,
  turbopack: { root: REPO_ROOT },
  // Stops `next dev` from writing an AGENTS.md. Agent guidance lives in the root CLAUDE.md.
  agentRules: false,
  // Don't announce the framework in every response.
  poweredByHeader: false,
  // The Content-Security-Policy is set per page load in src/proxy.ts, because it needs a nonce.
  headers: async () => [{ source: '/:path*', headers: SECURITY_HEADERS }],
  transpilePackages: [
    '@soundcheck/checks',
    '@soundcheck/db',
    '@soundcheck/report',
    '@soundcheck/shared',
  ],
};

export default nextConfig;
