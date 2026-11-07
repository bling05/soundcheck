import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanLeftoverFilesSite,
  FAKE_ENV,
  leftoverFilesSite,
} from '../../../fixtures/leftover-files';
import {
  startFixture,
  type FixtureSite,
  type RunningFixture,
} from '../../../fixtures/server';
import type { GuardedFetch, GuardedFetchResult } from '../request-guard';
import { testFetchFor } from '../request-guard/test-fetch';
import type { CheckContext } from '../types';
import { leftoverFiles } from './index';
import {
  countEnvSettings,
  findSourceMap,
  isDatabaseDump,
  isGitHead,
  isZip,
  readSourceMap,
} from './rules';

let site: RunningFixture;

afterEach(() => site?.stop());

async function contextFor(fixture: FixtureSite): Promise<CheckContext> {
  site = await startFixture(fixture);
  return { url: site.url, fetch: testFetchFor(site), platforms: [] };
}

async function findingsFor(context: CheckContext) {
  const result = await leftoverFiles.run(context);
  if (result.status !== 'ran') throw new Error(result.reason);
  return result.findings;
}

const HOME = '<!doctype html><h1>Hi</h1>';

/** A pretend site where some addresses fail, for answers a local fixture can't produce. */
function flakyContext(
  answer: (path: string) => GuardedFetchResult | undefined,
): CheckContext {
  const fetch: GuardedFetch = async (url) =>
    answer(new URL(url).pathname) ?? {
      ok: true,
      status: 404,
      headers: {},
      body: Buffer.from('Not found'),
      url,
      truncated: false,
    };
  return { url: 'https://site.test/', fetch, platforms: [] };
}

const ok = (path: string, body: string): GuardedFetchResult => ({
  ok: true,
  status: 200,
  headers: {},
  body: Buffer.from(body),
  url: `https://site.test${path}`,
  truncated: false,
});

const timeout: GuardedFetchResult = {
  ok: false,
  reason: 'timeout',
  message: 'The site took too long to respond.',
};

describe('leftover files check against fixture sites', () => {
  it('reports each kind of leftover file on the vulnerable site', async () => {
    const findings = await findingsFor(await contextFor(leftoverFilesSite));

    expect(findings.map(({ id }) => id)).toEqual([
      'leftover-files:env-file',
      'leftover-files:git-folder',
      'leftover-files:database-dump',
      'leftover-files:site-archive',
      'leftover-files:source-map',
    ]);
    expect(findings.map(({ severity }) => severity)).toEqual([
      'critical',
      'critical',
      'critical',
      'high',
      'low',
    ]);
  });

  it('reports nothing on a site that answers every address with its home page', async () => {
    const result = await leftoverFiles.run(
      await contextFor(cleanLeftoverFilesSite),
    );

    expect(result).toEqual({ status: 'ran', findings: [] });
  });

  it('says where each file is', async () => {
    const findings = await findingsFor(await contextFor(leftoverFilesSite));

    expect(findings[0]?.evidence).toEqual([
      {
        kind: 'url',
        url: `${site.url}.env`,
        detail: 'This file is public and holds 3 settings.',
      },
    ]);
    expect(findings[4]?.evidence[0]).toMatchObject({
      url: `${site.url}assets/app.js.map`,
      detail: 'Anyone can read your original code from this file.',
    });
  });

  it('never repeats what is inside a .env file', async () => {
    const findings = await findingsFor(await contextFor(leftoverFilesSite));
    const text = JSON.stringify(findings);

    expect(text).not.toContain('not-a-password');
    expect(text).not.toContain('fixture-not-a-real-key');
    expect(text).not.toContain('DATABASE_URL');
  });

  it('lists every place one kind of file was found in a single finding', async () => {
    const findings = await findingsFor(
      await contextFor({
        ...cleanLeftoverFilesSite,
        '/.env': { body: FAKE_ENV },
        '/.env.local': { body: FAKE_ENV },
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toEqual([
      expect.objectContaining({ url: `${site.url}.env` }),
      expect.objectContaining({ url: `${site.url}.env.local` }),
    ]);
    expect(findings[0]?.aiFix.problem).toBe(
      'Your secret settings file (.env) is public. Found at /.env, /.env.local',
    );
  });

  it('finds a source map with no comment pointing to it', async () => {
    const findings = await findingsFor(
      await contextFor({
        '/': leftoverFilesSite['/']!,
        '/assets/app.js': { body: 'console.log("hi");\n' },
        '/assets/app.js.map': leftoverFilesSite['/assets/app.js.map']!,
      }),
    );

    expect(findings.map(({ id }) => id)).toEqual(['leftover-files:source-map']);
  });

  it('gives the same ids on every scan', async () => {
    const context = await contextFor(leftoverFilesSite);

    const first = await findingsFor(context);
    const second = await findingsFor(context);

    expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
  });
});

describe('when parts of the site do not load', () => {
  it('is skipped, not passed, when a lookup fails and nothing was found', async () => {
    const result = await leftoverFiles.run(
      flakyContext((path) =>
        path === '/' ? ok('/', HOME) : path === '/.env' ? timeout : undefined,
      ),
    );

    expect(result).toMatchObject({ status: 'skipped' });
  });

  it('treats a server error or rate limit as unchecked, not missing', async () => {
    for (const status of [429, 503]) {
      const result = await leftoverFiles.run(
        flakyContext((path) =>
          path === '/'
            ? ok('/', HOME)
            : path === '/.git/HEAD'
              ? { ...ok(path, ''), status }
              : undefined,
        ),
      );

      expect(result).toMatchObject({ status: 'skipped' });
    }
  });

  it('still reports what it found, with a note, when a lookup fails', async () => {
    const result = await leftoverFiles.run(
      flakyContext((path) =>
        path === '/'
          ? ok('/', HOME)
          : path === '/.env'
            ? ok(path, FAKE_ENV)
            : path === '/db.sql'
              ? timeout
              : undefined,
      ),
    );

    expect(result).toMatchObject({ status: 'ran', note: expect.any(String) });
    if (result.status === 'ran') expect(result.findings).toHaveLength(1);
  });

  it('ignores a file that redirects to another site', async () => {
    const result = await leftoverFiles.run(
      flakyContext((path) =>
        path === '/'
          ? ok('/', HOME)
          : path === '/.env'
            ? { ...ok(path, FAKE_ENV), url: 'https://other.test/.env' }
            : undefined,
      ),
    );

    expect(result).toEqual({ status: 'ran', findings: [] });
  });

  it('is skipped when the home page is an error', async () => {
    const result = await leftoverFiles.run(
      flakyContext((path) =>
        path === '/' ? { ...ok('/', HOME), status: 403 } : undefined,
      ),
    );

    expect(result).toMatchObject({ status: 'skipped' });
  });
});

describe('recognizing files', () => {
  it('counts the settings in a .env file', () => {
    expect(countEnvSettings(FAKE_ENV)).toBe(3);
  });

  it.each([
    ['a web page', HOME],
    ['a code file', 'const x = 1;\nexport default x;'],
    ['plain text with one setting-like line', 'Hello there\nA=b\nThanks'],
    ['an empty file', ''],
  ])('does not mistake %s for a .env file', (_name, text) => {
    expect(countEnvSettings(text)).toBe(0);
  });

  it('recognizes .git/HEAD', () => {
    expect(isGitHead('ref: refs/heads/main\n')).toBe(true);
    expect(isGitHead('0123456789abcdef0123456789abcdef01234567')).toBe(true);
    expect(isGitHead(HOME)).toBe(false);
  });

  it('recognizes a database copy but not a page that mentions SQL', () => {
    expect(isDatabaseDump('-- MySQL dump 10.13\n')).toBe(true);
    expect(isDatabaseDump(`${HOME}<p>Use INSERT INTO to add rows.</p>`)).toBe(
      false,
    );
  });

  it('recognizes a zip by its first bytes', () => {
    expect(isZip(Buffer.from('PK\u0003\u0004rest'))).toBe(true);
    expect(isZip(Buffer.from(HOME))).toBe(false);
  });

  it('tells a source map with code from one with only file names', () => {
    expect(
      readSourceMap('{"version":3,"sources":["a.ts"],"sourcesContent":["x"]}'),
    ).toBe('code');
    expect(readSourceMap('{"version":3,"sources":["a.ts"]}')).toBe(
      'file-names',
    );
    expect(readSourceMap(HOME)).toBeUndefined();
  });

  it('reads a source map built into a code file', () => {
    const map = Buffer.from(
      '{"version":3,"sources":["a.ts"],"sourcesContent":["x"]}',
    ).toString('base64');

    expect(
      findSourceMap(
        `x();\n//# sourceMappingURL=data:application/json;base64,${map}`,
        'https://site.test/app.js',
      ),
    ).toEqual({ kind: 'inline', contents: 'code' });
  });
});

describe('finding contents', () => {
  it('has everything a finding needs', async () => {
    const findings = await findingsFor(await contextFor(leftoverFilesSite));

    for (const finding of findings) {
      expect(finding).toMatchObject({
        checkId: 'leftover-files',
        source: 'live',
      });
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.manualFix.snippet).not.toBe('');
      expect(finding.aiFix.request).not.toBe('');
    }
  });

  it('asks people to replace keys when a file could have held them', async () => {
    const findings = await findingsFor(await contextFor(leftoverFilesSite));
    const withSteps = findings
      .filter(({ safetyStep }) => safetyStep)
      .map(({ id }) => id);

    expect(withSteps).toEqual([
      'leftover-files:env-file',
      'leftover-files:git-folder',
      'leftover-files:database-dump',
    ]);
  });

  it('names the Next.js setting for source maps on a Next.js site', async () => {
    const context = await contextFor(leftoverFilesSite);
    const findings = await findingsFor({
      ...context,
      technologies: ['nextjs'],
    });
    const sourceMap = findings.find(({ id }) => id.endsWith('source-map'));

    expect(sourceMap?.manualFix.snippet).toContain(
      'productionBrowserSourceMaps',
    );
  });
});
