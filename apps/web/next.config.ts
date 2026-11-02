import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Stops `next dev` from writing an AGENTS.md. Agent guidance lives in the root CLAUDE.md.
  agentRules: false,
  transpilePackages: ['@soundcheck/report', '@soundcheck/shared'],
};

export default nextConfig;
