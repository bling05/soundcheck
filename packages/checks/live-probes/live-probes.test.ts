import { LESSONS } from '@soundcheck/report';
import { describe, expect, it } from 'vitest';
import { bundleSecrets } from '../bundle-secrets';
import { geminiAccess, GEMINI_MODELS } from '../bundle-secrets/gemini';
import type { GuardedFetch, GuardedFetchResult } from '../request-guard';
import { FAKE_KEYS } from '../../../fixtures/bundle-secrets';
import { liveProbes } from './index';
import {
  probeApi,
  probeSignup,
  probeSqlError,
  probeTraversal,
  probeXss,
  recordsIn,
} from './probes';
import { findTargets } from './targets';

const SITE = 'https://shop.test';

interface Answer {
  status?: number;
  type?: string;
  body?: string;
}

/** A fake site: `answer` decides the response for each full address. */
function fakeSite(answer: (url: URL) => Answer | undefined) {
  const asked: string[] = [];
  const fetch: GuardedFetch = async (target) => {
    asked.push(target);
    const url = new URL(target);
    const found = answer(url) ?? { status: 404, body: 'Not found' };
    const result: GuardedFetchResult = {
      ok: true,
      status: found.status ?? 200,
      headers: { 'content-type': found.type ?? 'text/html' },
      body: Buffer.from(found.body ?? ''),
      url: target,
      truncated: false,
    };
    return result;
  };
  return { fetch, asked };
}

const HOME = `<html><body>
<a href="/products?category=shoes&amp;sort=asc">Shoes</a>
<a href="https://elsewhere.test/page?x=1">Other site</a>
<a href="/logout?next=/">Sign out</a>
<form action="/search" method="get"><input name="q"></form>
<form action="/subscribe" method="post"><input name="email"></form>
<a href="/download?file=guide.pdf">Guide</a>
</body></html>`;

describe('choosing what to try', () => {
  it('uses the home page and its own links and GET forms, never other sites, sign-out, or POST', () => {
    expect(findTargets(HOME, `${SITE}/`)).toEqual([
      { url: `${SITE}/`, params: ['q', 'search'] },
      { url: `${SITE}/products`, params: ['category', 'sort'] },
      { url: `${SITE}/download`, params: ['file'] },
      { url: `${SITE}/search`, params: ['q'] },
    ]);
  });
});

describe('reflected XSS', () => {
  const target = { url: `${SITE}/search`, params: ['q'] };

  it('reports a page that puts the made-up tag back as HTML', async () => {
    const { fetch } = fakeSite((url) => ({
      body: `<p>Results for ${url.searchParams.get('q')}</p>`,
    }));
    expect(await probeXss(target, 'q', fetch, 'scxtest')).toMatchObject({
      kind: 'reflected-xss',
      url: `${SITE}/search`,
      param: 'q',
    });
  });

  it('accepts a page that escapes it', async () => {
    const { fetch } = fakeSite((url) => ({
      body: `<p>Results for ${(url.searchParams.get('q') ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
    }));
    expect(await probeXss(target, 'q', fetch, 'scxtest')).toBeUndefined();
  });
});

describe('SQL error text', () => {
  const target = { url: `${SITE}/products`, params: ['category'] };

  it('reports a database error caused by a quote mark', async () => {
    const { fetch } = fakeSite((url) =>
      url.searchParams.get('category')?.includes("'")
        ? {
            status: 500,
            body: 'Error: unterminated quoted string at or near "\'1\'"',
          }
        : { body: '<p>Products</p>' },
    );
    expect(await probeSqlError(target, 'category', fetch)).toMatchObject({
      kind: 'sql-error',
      detail: expect.stringContaining('unterminated quoted string at or near'),
    });
  });

  it('ignores a page that shows the same text either way, like a tutorial about SQL', async () => {
    const { fetch } = fakeSite(() => ({
      body: 'Fixing "syntax error at or near" in Postgres',
    }));
    expect(await probeSqlError(target, 'category', fetch)).toBeUndefined();
  });
});

describe('path traversal', () => {
  it('reports a system file coming back, without keeping it', async () => {
    const { fetch } = fakeSite((url) =>
      url.searchParams.get('file')?.includes('etc/passwd')
        ? {
            type: 'text/plain',
            body: 'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1::/:',
          }
        : { body: 'Guide' },
    );
    const found = await probeTraversal(
      { url: `${SITE}/download`, params: ['file'] },
      'file',
      fetch,
    );
    expect(found).toMatchObject({ kind: 'path-traversal', param: 'file' });
    expect(JSON.stringify(found)).not.toContain('root:x');
  });
});

describe('open API routes', () => {
  it('reports a list of people with personal fields, by count and field names only', async () => {
    const users = [
      { id: 1, email: 'a@example.com', name: 'A' },
      { id: 2, email: 'b@example.com', name: 'B' },
    ];
    const { fetch } = fakeSite((url) =>
      url.pathname === '/api/users'
        ? { type: 'application/json', body: JSON.stringify({ data: users }) }
        : undefined,
    );
    const found = await probeApi(SITE, '/api/users', fetch);
    expect(found?.detail).toContain('2 records with fields like email');
    expect(JSON.stringify(found)).not.toContain('a@example.com');
  });

  it('ignores lists without personal details, sign-in errors, and HTML pages', async () => {
    const { fetch } = fakeSite((url) => {
      if (url.pathname === '/api/users')
        return { type: 'application/json', body: '[{"id":1,"title":"Post"}]' };
      if (url.pathname === '/api/admin/users')
        return {
          status: 401,
          type: 'application/json',
          body: '{"error":"no"}',
        };
      return { body: '<html>app</html>' };
    });
    for (const path of ['/api/users', '/api/admin/users', '/api/customers'])
      expect(await probeApi(SITE, path, fetch)).toBeUndefined();
  });

  it.each([
    [[{ a: 1 }], 1],
    [{ users: [{ a: 1 }, { b: 2 }] }, 2],
    [{ message: 'hi' }, 0],
  ])('finds the records in %j', (json, count) => {
    expect(recordsIn(json)).toHaveLength(count);
  });
});

describe('Supabase sign-up', () => {
  const project = {
    url: 'https://abc.supabase.co',
    key: 'sb_publishable_x',
    isToken: false,
  };
  const settings = (value: object) =>
    fakeSite((url) =>
      url.pathname === '/auth/v1/settings'
        ? { type: 'application/json', body: JSON.stringify(value) }
        : undefined,
    ).fetch;

  it('reports open sign-up with no email confirmation', async () => {
    expect(
      await probeSignup(
        project,
        settings({ disable_signup: false, mailer_autoconfirm: true }),
      ),
    ).toMatchObject({ kind: 'open-signup' });
  });

  it.each([
    { disable_signup: true, mailer_autoconfirm: true },
    { disable_signup: false, mailer_autoconfirm: false },
  ])('accepts %j', async (value) => {
    expect(await probeSignup(project, settings(value))).toBeUndefined();
  });
});

describe('the check', () => {
  it('runs every probe on a verified site and reports what it finds, gently', async () => {
    const { fetch, asked } = fakeSite((url) => {
      if (url.pathname === '/') return { body: HOME };
      if (url.pathname === '/search')
        return { body: `<p>${url.searchParams.get('q') ?? ''}</p>` };
      if (url.pathname === '/api/users')
        return {
          type: 'application/json',
          body: '[{"email":"x@example.com","password_hash":"..."}]',
        };
      return undefined;
    });
    const result = await liveProbes.run({
      url: `${SITE}/`,
      fetch,
      platforms: [],
    });
    if (result.status !== 'ran') throw new Error('did not run');
    expect(
      result.findings.map(({ title, severity }) => [severity, title]),
    ).toEqual([
      ['critical', "Your API lists people's details to anyone"],
      [
        'high',
        'Your site puts text from the address back into the page as HTML',
      ],
    ]);
    for (const finding of result.findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.source).toBe('live');
      // The payload is never repeated in the report.
      expect(JSON.stringify(finding)).not.toMatch(/<scx|etc\/passwd/);
    }
    expect(asked.length).toBeLessThan(80);
    expect(liveProbes).toMatchObject({ mode: 'url-active', platforms: 'all' });
  });
});

describe('the Gemini key test in Check #2', () => {
  const googleSite = (gemini: Answer) =>
    fakeSite((url) => {
      if (url.href.startsWith(GEMINI_MODELS)) return gemini;
      if (url.pathname === '/')
        return {
          body: `<script>const firebase = { apiKey: "${FAKE_KEYS.googleApiKey}" };</script>`,
        };
      return undefined;
    });

  it.each([
    [{ status: 200, type: 'application/json', body: '{"models":[]}' }, 'works'],
    [
      {
        status: 403,
        type: 'application/json',
        body: '{"error":{"status":"PERMISSION_DENIED"}}',
      },
      'blocked',
    ],
    [
      {
        status: 400,
        type: 'application/json',
        body: '{"error":{"status":"INVALID_ARGUMENT"}}',
      },
      'blocked',
    ],
    [{ status: 503, body: '' }, 'unknown'],
  ])('reads %j as %s', async (answer, access) => {
    expect(
      await geminiAccess(FAKE_KEYS.googleApiKey, googleSite(answer).fetch),
    ).toBe(access);
  });

  it('confirms the problem for a verified owner when the key works for Gemini', async () => {
    const result = await bundleSecrets.run({
      url: `${SITE}/`,
      fetch: googleSite({ status: 200, type: 'application/json', body: '{}' })
        .fetch,
      platforms: [],
      verified: true,
    });
    expect(result).toMatchObject({
      status: 'ran',
      findings: [
        {
          title: 'Your Google API key can use Gemini, billed to you',
          severity: 'high',
        },
      ],
    });
  });

  it('drops the warning when Gemini refuses the key, and never tests unverified', async () => {
    const blocked = googleSite({ status: 403, body: '{}' });
    expect(
      await bundleSecrets.run({
        url: `${SITE}/`,
        fetch: blocked.fetch,
        platforms: [],
        verified: true,
      }),
    ).toMatchObject({ status: 'ran', findings: [] });

    const unverified = googleSite({ status: 200, body: '{}' });
    const result = await bundleSecrets.run({
      url: `${SITE}/`,
      fetch: unverified.fetch,
      platforms: [],
    });
    expect(result).toMatchObject({ findings: [{ severity: 'medium' }] });
    expect(unverified.asked.some((url) => url.startsWith(GEMINI_MODELS))).toBe(
      false,
    );
  });
});
