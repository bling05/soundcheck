import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@soundcheck/db', () => ({
  failStuckScans: vi.fn(async () => 1),
  deleteExpiredData: vi.fn(async () => ({ scans: 2, requesters: 3 })),
}));

const { deleteExpiredData } = await import('@soundcheck/db');
const { GET } = await import('./route');

const call = (authorization?: string) =>
  GET(
    new Request('https://soundcheck.test/api/cron/cleanup', {
      headers: authorization ? { authorization } : {},
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(deleteExpiredData).mockClear();
});

describe('the daily cleanup route', () => {
  it("runs cleanup for Vercel's scheduler", async () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');

    const response = await call('Bearer the-secret');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      stuck: 1,
      scans: 2,
      requesters: 3,
    });
  });

  it.each([
    ['no secret', undefined],
    ['the wrong secret', 'Bearer not-it'],
    ['the secret without Bearer', 'the-secret'],
  ])('refuses a request with %s', async (_name, authorization) => {
    vi.stubEnv('CRON_SECRET', 'the-secret');

    const response = await call(authorization);

    expect(response.status).toBe(401);
    expect(deleteExpiredData).not.toHaveBeenCalled();
  });

  it('refuses everyone when the secret is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');

    expect((await call('Bearer ')).status).toBe(401);
    expect(deleteExpiredData).not.toHaveBeenCalled();
  });
});
