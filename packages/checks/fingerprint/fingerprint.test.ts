import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blogAboutToolsSite,
  firebaseSite,
  lovableTemplateSite,
  nextjsOnVercelSite,
  supabaseSite,
  viteSite,
} from '../../../fixtures/fingerprint';
import {
  startFixture,
  type FixtureSite,
  type RunningFixture,
} from '../../../fixtures/server';
import type { GuardedFetch } from '../request-guard';
import { testFetchFor } from '../request-guard/test-fetch';
import { findCodeFiles } from '../site-files';
import { fingerprintSite } from './index';

let site: RunningFixture | undefined;

afterEach(async () => {
  await site?.stop();
  site = undefined;
  vi.restoreAllMocks();
});

async function scan(fixture: FixtureSite) {
  site = await startFixture(fixture);
  const result = await fingerprintSite(site.url, testFetchFor(site));
  if (!result.ok) throw new Error(result.message);
  return result;
}

/** A pretend site at any address, for clues a local fixture can't produce. */
function fakeVisit(
  overrides: { headers?: Record<string, string>; body?: string } = {},
): GuardedFetch {
  return async (url) => ({
    ok: true,
    status: 200,
    headers: overrides.headers ?? {},
    body: Buffer.from(overrides.body ?? ''),
    url,
    truncated: false,
  });
}

const names = (result: { detections: { technology: string }[] }) =>
  result.detections.map(({ technology }) => technology);

function siteWithCodeFiles(count: number, lastFileBody = ''): FixtureSite {
  const tags = Array.from(
    { length: count },
    (_, index) => `<script src="/${index}.js"></script>`,
  );
  const pages: FixtureSite = { '/': { body: tags.join('') } };
  for (let index = 0; index < count; index++) {
    pages[`/${index}.js`] = { body: index === count - 1 ? lastFileBody : '' };
  }
  return pages;
}

describe('fingerprintSite detects', () => {
  it('Supabase when the address is in a late code file', async () => {
    const result = await scan(
      siteWithCodeFiles(
        18,
        'createClient("https://fixturefixturefixtur.supabase.co")',
      ),
    );

    expect(result).toMatchObject({
      platforms: ['supabase'],
      complete: true,
      filesRead: 18,
    });
  });

  it('Supabase from an address inside a code file', async () => {
    const result = await scan(supabaseSite);

    expect(names(result)).toEqual(['supabase']);
    expect(result.platforms).toEqual(['supabase']);
    expect(result.detections[0]?.foundAt).toContain('/assets/app.js');
    expect(result).toMatchObject({ complete: true, filesRead: 1 });
  });

  it('Firebase from an address inside a code file', async () => {
    const result = await scan(firebaseSite);

    expect(names(result)).toEqual(['firebase']);
    expect(result.platforms).toEqual(['firebase']);
  });

  it('Next.js and Vercel from headers and page content', async () => {
    const result = await scan(nextjsOnVercelSite);

    expect(names(result)).toEqual(['nextjs', 'vercel']);
    expect(result.platforms).toEqual([]);
  });

  it('Vite from its build file name', async () => {
    expect(names(await scan(viteSite))).toEqual(['vite']);
  });

  it('Vite when hosting has rewritten the script tag', async () => {
    const result = await fingerprintSite(
      'https://site.test/',
      fakeVisit({
        body: '<script type="module" async="" src="/assets/index-Br7pOPeM.js"></script>',
      }),
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(names(result)).toEqual(['vite']);
  });

  it('no Vite from an ordinary script in an assets folder', async () => {
    const result = await fingerprintSite(
      'https://site.test/',
      fakeVisit({ body: '<script src="/assets/menu.js"></script>' }),
    );

    expect(result).toMatchObject({ ok: true, detections: [] });
  });

  it('Lovable from its template, and sets it as the tool', async () => {
    const result = await scan(lovableTemplateSite);

    expect(names(result)).toEqual(['lovable']);
    expect(result.tool).toBe('lovable');
  });

  it.each([
    ['https://my-app.lovable.app/', 'lovable', 'lovable'],
    ['https://my-app.bolt.host/', 'bolt', 'bolt'],
    ['https://my-app.base44.app/', 'base44', undefined],
    ['https://my-app.vercel.app/', 'vercel', undefined],
    ['https://my-app.web.app/', 'firebase', undefined],
    ['https://my-app.firebaseapp.com/', 'firebase', undefined],
  ])('the host of %s', async (url, technology, tool) => {
    const result = await fingerprintSite(url, fakeVisit());

    expect(result).toMatchObject({ ok: true, tool });
    if (result.ok) expect(names(result)).toEqual([technology]);
  });

  it('the host the site redirected to', async () => {
    const visit: GuardedFetch = async (url) => ({
      ...(await fakeVisit()(url)),
      url: 'https://my-app.lovable.app/',
    });

    const result = await fingerprintSite('https://short.test/', visit);

    expect(result).toMatchObject({ ok: true, tool: 'lovable' });
  });
});

describe('fingerprintSite avoids false alarms', () => {
  it('detects nothing on a page that only talks about these tools', async () => {
    const result = await scan(blogAboutToolsSite);

    expect(result.detections).toEqual([]);
    expect(result).toMatchObject({ platforms: [], complete: true });
    expect(result.tool).toBeUndefined();
  });

  it.each([
    ['https://notlovable.app/'],
    ['https://my-app.lovable.app.evil.test/'],
    ['https://vercel.app.evil.test/'],
  ])('does not treat the lookalike host %s as a match', async (url) => {
    const result = await fingerprintSite(url, fakeVisit());

    expect(result).toMatchObject({ ok: true, detections: [] });
  });

  it('ignores a Supabase-looking address with a wrong project id', async () => {
    const result = await fingerprintSite(
      'https://site.test/',
      fakeVisit({ body: 'https://docs.supabase.co/guide' }),
    );

    expect(result).toMatchObject({ ok: true, detections: [] });
  });

  it('does not read code files hosted on other sites', async () => {
    const fixture: FixtureSite = {
      '/': {
        body: '<script src="https://widget.test/chat.js"></script><script src="/own.js"></script>',
      },
      '/own.js': { body: '' },
    };
    site = await startFixture(fixture);
    const visited: string[] = [];
    const fetchForSite = testFetchFor(site);
    const visit: GuardedFetch = (url, options) => {
      visited.push(url);
      return fetchForSite(url, options);
    };

    const result = await fingerprintSite(site.url, visit);

    expect(result).toMatchObject({
      ok: true,
      filesRead: 1,
      filesFromOtherSites: 1,
      complete: true,
    });
    expect(visited.some((url) => url.includes('widget.test'))).toBe(false);
  });
});

describe('fingerprintSite is honest about what it could not read', () => {
  it('returns the failure when the home page cannot be reached', async () => {
    const visit: GuardedFetch = async () => ({
      ok: false,
      reason: 'timeout',
      message: 'The site took too long to respond.',
    });

    const result = await fingerprintSite('https://site.test/', visit);

    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('marks the result incomplete when a code file is missing', async () => {
    const result = await scan({
      '/': { body: '<script src="/gone.js"></script>' },
    });

    expect(result).toMatchObject({
      complete: false,
      filesRead: 0,
      filesNotRead: 1,
    });
  });

  it('reads at most 50 code files and counts the rest as not read', async () => {
    const result = await scan(siteWithCodeFiles(52));

    expect(result).toMatchObject({
      complete: false,
      filesRead: 50,
      filesNotRead: 2,
    });
  });

  it('stops reading code files when it runs out of time', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    site = await startFixture(siteWithCodeFiles(3));
    const fetchForSite = testFetchFor(site);
    const visit: GuardedFetch = async (url, options) => {
      const response = await fetchForSite(url, options);
      if (url.endsWith('/0.js')) now = 31_000;
      return response;
    };

    const result = await fingerprintSite(site.url, visit);

    expect(result).toMatchObject({
      ok: true,
      complete: false,
      filesRead: 1,
      filesNotRead: 2,
    });
  });

  it('stops reading code files after too much data', async () => {
    const big = Buffer.alloc(30 * 1024 * 1024);
    const visit: GuardedFetch = async (url) => ({
      ok: true,
      status: 200,
      headers: {},
      body: url.endsWith('.js')
        ? big
        : Buffer.from(
            '<script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script>',
          ),
      url,
      truncated: false,
    });

    const result = await fingerprintSite('https://site.test/', visit);

    expect(result).toMatchObject({
      ok: true,
      complete: false,
      filesRead: 2,
      filesNotRead: 1,
    });
  });

  it('marks the result incomplete when the home page is an error', async () => {
    const result = await scan({ '/': { status: 403, body: 'Blocked' } });

    expect(result).toMatchObject({ complete: false, detections: [] });
  });

  it('marks the result incomplete when a response is compressed', async () => {
    const result = await fingerprintSite(
      'https://site.test/',
      fakeVisit({ headers: { 'content-encoding': 'gzip' } }),
    );

    expect(result).toMatchObject({ ok: true, complete: false });
  });

  it('marks the result incomplete when a response was cut off', async () => {
    const visit: GuardedFetch = async (url) => ({
      ...(await fakeVisit()(url)),
      truncated: true,
    });

    const result = await fingerprintSite('https://site.test/', visit);

    expect(result).toMatchObject({ ok: true, complete: false });
  });
});

describe('fingerprintSite output', () => {
  it('leaves query strings out of where it found things', async () => {
    const result = await fingerprintSite(
      'https://my-app.lovable.app/?token=fake-secret',
      fakeVisit(),
    );

    expect(JSON.stringify(result)).not.toContain('fake-secret');
  });

  it('returns no site content', async () => {
    const result = await scan(supabaseSite);

    expect(JSON.stringify(result)).not.toContain('fixturefixturefixtur');
    expect(JSON.stringify(result)).not.toContain('fake-key');
  });

  it('gives the same answer every time', async () => {
    const first = await scan(nextjsOnVercelSite);
    await site?.stop();
    const second = await scan(nextjsOnVercelSite);

    expect(names(second)).toEqual(names(first));
  });
});

describe('findCodeFiles', () => {
  it('finds scripts and preloaded modules as full URLs without repeats', () => {
    const html = `
      <script src="/a.js"></script>
      <script defer src='b.js'></script>
      <script src=/c.js></script>
      <script src="/a.js"></script>
      <script>inline()</script>
      <link rel="modulepreload" href="/d.js">
      <link rel="stylesheet" href="/style.css">
    `;

    expect(findCodeFiles(html, 'https://site.test/page/')).toEqual([
      'https://site.test/a.js',
      'https://site.test/page/b.js',
      'https://site.test/c.js',
      'https://site.test/d.js',
    ]);
  });

  it('skips addresses that are broken', () => {
    expect(
      findCodeFiles('<script src="http://"></script>', 'https://site.test/'),
    ).toEqual([]);
  });
});
