import { fetchWithPolicy, type GuardedFetch } from './guarded-fetch';

/**
 * For tests only. Runs the real guard code, but allows one fake site on this machine
 * and nothing else. It isn't exported from the package, so the live site can't reach it.
 */
export function testFetchFor(site: { port: number }): GuardedFetch {
  return (target, options = {}) =>
    fetchWithPolicy(target, options, {
      isAddressAllowed: (address) => address === '127.0.0.1',
      allowedPorts: [site.port],
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    });
}
