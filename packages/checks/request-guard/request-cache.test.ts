import { describe, expect, it } from 'vitest';
import type { GuardedFetch, GuardedFetchResult } from './guarded-fetch';
import { withRequestCache } from './request-cache';

function counting() {
  const calls: string[] = [];
  const fetch: GuardedFetch = async (target, options) => {
    calls.push(`${target} ${options?.maxBytes ?? ''}`.trim());
    return {
      ok: true,
      status: 200,
      headers: {},
      body: Buffer.from(target),
      url: target,
      truncated: false,
    };
  };
  return { calls, fetch };
}

describe('withRequestCache', () => {
  it('visits each address once and gives every caller the same answer', async () => {
    const { calls, fetch } = counting();
    const cached = withRequestCache(fetch);

    const first = await cached('https://site.test/');
    const second = await cached('https://site.test/');

    expect(calls).toEqual(['https://site.test/']);
    expect(second).toBe(first);
  });

  it('shares one request between callers asking at the same time', async () => {
    const { calls, fetch } = counting();
    const cached = withRequestCache(fetch);

    await Promise.all([
      cached('https://site.test/'),
      cached('https://site.test/'),
    ]);

    expect(calls).toHaveLength(1);
  });

  it('treats different options as a different request', async () => {
    const { calls, fetch } = counting();
    const cached = withRequestCache(fetch);

    await cached('https://site.test/.env');
    await cached('https://site.test/.env', { maxBytes: 1024 });

    expect(calls).toEqual([
      'https://site.test/.env',
      'https://site.test/.env 1024',
    ]);
  });

  it('remembers a failure, so a slow site is not asked again by every check', async () => {
    let calls = 0;
    const timeout: GuardedFetchResult = {
      ok: false,
      reason: 'timeout',
      message: 'The site took too long to respond.',
    };
    const cached = withRequestCache(async () => {
      calls++;
      return timeout;
    });

    await cached('https://site.test/');
    const again = await cached('https://site.test/');

    expect(calls).toBe(1);
    expect(again).toEqual(timeout);
  });

  it('keeps separate scans separate', async () => {
    const { calls, fetch } = counting();

    await withRequestCache(fetch)('https://site.test/');
    await withRequestCache(fetch)('https://site.test/');

    expect(calls).toHaveLength(2);
  });
});
