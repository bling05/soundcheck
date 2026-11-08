import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import { startFixture, type RunningFixture } from '../../../fixtures/server';
import { testFetchFor } from '../request-guard/test-fetch';
import {
  checkCookies,
  checkCors,
  isLoginCookie,
  parseCookies,
  TEST_ORIGIN,
} from './cookies-cors';
import { securityHeaders } from './index';

let site: RunningFixture | undefined;
afterEach(async () => {
  await site?.stop();
  site = undefined;
});

/** A site whose home page sends these headers, run through the whole check. */
async function siteThat(headers: Record<string, string>) {
  site = await startFixture({ '/': { headers, body: '<h1>Hi</h1>' } });
  const result = await securityHeaders.run({
    url: site.url,
    fetch: testFetchFor(site),
    platforms: [],
  });
  if (result.status !== 'ran') throw new Error('did not run');
  return result.findings;
}

const ruleIds = (findings: Awaited<ReturnType<typeof siteThat>>) =>
  findings
    .map(({ id }) => id.split(':')[1])
    .filter((rule) => rule?.startsWith('cors') || rule?.startsWith('cookie'));

describe('CORS', () => {
  it('reports a site that copies back any website and allows logins', async () => {
    // What a site that copies back every website sends when we ask as our test one.
    const findings = await siteThat({
      'access-control-allow-origin': TEST_ORIGIN,
      'access-control-allow-credentials': 'true',
    });

    expect(ruleIds(findings)).toEqual(['cors-any-site']);
    expect(findings.find(({ id }) => id.includes('cors'))?.severity).toBe(
      'high',
    );
  });

  it.each([
    [
      'plain *, since browsers never send logins with it',
      { 'access-control-allow-origin': '*' },
    ],
    [
      'copying back the website without allowing logins',
      { 'access-control-allow-origin': TEST_ORIGIN },
    ],
    [
      'a fixed list that leaves us out',
      {
        'access-control-allow-origin': 'https://partner.example',
        'access-control-allow-credentials': 'true',
      },
    ],
  ])('does not report %s', (_name, headers) => {
    expect(checkCors(headers)).toBeNull();
  });

  it('reports the "null" website with logins, which sandboxed pages can use', () => {
    expect(
      checkCors({
        'access-control-allow-origin': 'null',
        'access-control-allow-credentials': 'true',
      }),
    ).toMatchObject({ rule: 'cors-any-site' });
  });
});

describe('cookies', () => {
  it('reports a login cookie missing its flags, naming it but never its value', async () => {
    const findings = await siteThat({
      'set-cookie': 'session=secret-value-123; Path=/',
    });

    // The fake site is plain http, so only HttpOnly can be judged here.
    expect(ruleIds(findings)).toEqual(['cookie-not-httponly']);
    expect(JSON.stringify(findings)).not.toContain('secret-value-123');
    expect(JSON.stringify(findings)).toContain('session');
  });

  it('judges Secure on HTTPS pages', () => {
    const problems = checkCookies(
      { 'set-cookie': ['auth_token=x; HttpOnly'] },
      true,
    );

    expect(problems.map(({ rule }) => rule)).toEqual(['cookie-not-secure']);
  });

  it('accepts a well-made login cookie', () => {
    expect(
      checkCookies(
        { 'set-cookie': ['sid=x; Secure; HttpOnly; SameSite=Lax; Path=/'] },
        true,
      ),
    ).toEqual([]);
  });

  it('leaves analytics and CSRF cookies alone', () => {
    expect(
      checkCookies(
        { 'set-cookie': ['_ga=GA1.1.1; Path=/', 'csrftoken=abc; Path=/'] },
        true,
      ),
    ).toEqual([]);
  });

  it('reads flags in any letter case', () => {
    expect(parseCookies({ 'set-cookie': 'a=b; SECURE; httponly' })).toEqual([
      { name: 'a', secure: true, httpOnly: true },
    ]);
  });

  it.each([
    ['session', true],
    ['connect.sid', true],
    ['sb-abc-auth-token', true],
    ['remember_me', true],
    ['XSRF-TOKEN', false],
    ['theme', false],
    ['_ga', false],
  ])('treats %s as a login cookie: %s', (name, expected) => {
    expect(isLoginCookie(name)).toBe(expected);
  });
});

describe('the new rules', () => {
  it.each(['cors-any-site', 'cookie-not-secure', 'cookie-not-httponly'])(
    '%s has an explanation',
    (rule) => {
      expect(
        LESSONS[`security-headers:${rule}` as keyof typeof LESSONS],
      ).toBeDefined();
    },
  );
});
