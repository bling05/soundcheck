import { afterEach, describe, expect, it } from 'vitest';
import {
  missingSecurityHeaders,
  secureSecurityHeaders,
} from '../../fixtures/security-headers';
import { startFixture, type RunningFixture } from '../../fixtures/server';
import { guardedFetch } from './request-guard';
import { testFetchFor } from './request-guard/test-fetch';
import type { CheckContext } from './types';

const SECURITY_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
];

let site: RunningFixture;

afterEach(() => site.stop());

describe('fixture sites', () => {
  it('reach a check through the fetch in its context', async () => {
    site = await startFixture(missingSecurityHeaders);
    const context: CheckContext = {
      url: site.url,
      fetch: testFetchFor(site),
      platforms: [],
    };

    const result = await context.fetch(site.url);

    expect(result).toMatchObject({ ok: true, status: 200 });
    if (result.ok) expect(result.body.toString()).toContain('Hello');
  });

  it('leave out every security header on the vulnerable site', async () => {
    site = await startFixture(missingSecurityHeaders);

    const result = await testFetchFor(site)(site.url);

    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const header of SECURITY_HEADERS) {
        expect(result.headers).not.toHaveProperty(header);
      }
    }
  });

  it('send every security header on the clean site', async () => {
    site = await startFixture(secureSecurityHeaders);

    const result = await testFetchFor(site)(site.url);

    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const header of SECURITY_HEADERS) {
        expect(result.headers).toHaveProperty(header);
      }
    }
  });

  it('answer an unknown path with a 404', async () => {
    site = await startFixture(missingSecurityHeaders);

    const result = await testFetchFor(site)(`${site.url}nope`);

    expect(result).toMatchObject({ ok: true, status: 404 });
  });

  it('stop answering once stopped', async () => {
    const stopped = await startFixture(missingSecurityHeaders);
    await stopped.stop();
    site = await startFixture(missingSecurityHeaders);

    const result = await testFetchFor(stopped)(stopped.url);

    expect(result).toMatchObject({ ok: false, reason: 'network-error' });
  });
});

describe('the fixture safety boundaries', () => {
  it('real guard refuses to visit a fixture', async () => {
    site = await startFixture(missingSecurityHeaders);

    const result = await guardedFetch(site.url);

    expect(result).toMatchObject({ ok: false, reason: 'blocked-address' });
  });

  it.each([
    ['http://169.254.169.254/', 'blocked-address'],
    ['http://10.0.0.1/', 'blocked-address'],
    ['file:///etc/passwd', 'blocked-scheme'],
  ])('test fetch still refuses %s', async (url, reason) => {
    site = await startFixture(missingSecurityHeaders);

    const result = await testFetchFor(site)(url);

    expect(result).toMatchObject({ ok: false, reason });
  });

  it('test fetch cannot reach a different port on this machine', async () => {
    site = await startFixture(missingSecurityHeaders);
    const other = await startFixture(secureSecurityHeaders);

    const result = await testFetchFor(site)(other.url);
    await other.stop();

    expect(result).toMatchObject({ ok: false, reason: 'blocked-port' });
  });
});
