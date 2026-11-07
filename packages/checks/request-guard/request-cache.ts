import type {
  GuardedFetch,
  GuardedFetchOptions,
  GuardedFetchResult,
} from './guarded-fetch';

/**
 * Wraps a fetch so each address is visited once. Fingerprinting and most checks read the
 * same home page and code files, so one scan would otherwise download them several times.
 *
 * Make one per scan and drop it when the scan ends: it holds page bodies in memory, and
 * those must never outlive the scan. Failures are remembered too, so a site that timed out
 * once isn't asked again by every check. A request with different options, like a smaller
 * size limit, counts as a different request.
 */
export function withRequestCache(fetch: GuardedFetch): GuardedFetch {
  const seen = new Map<string, Promise<GuardedFetchResult>>();
  return (target: string, options: GuardedFetchOptions = {}) => {
    const key = JSON.stringify([
      target,
      options.method ?? 'GET',
      options.maxBytes ?? null,
      options.timeoutMs ?? null,
    ]);
    let result = seen.get(key);
    if (!result) {
      result = fetch(target, options);
      seen.set(key, result);
    }
    return result;
  };
}
