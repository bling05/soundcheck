import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import { startFixture, type RunningFixture } from '../../../fixtures/server';
import { testFetchFor } from '../request-guard/test-fetch';
import { ADVISORIES } from './advisories';
import { nextjsVersion } from './index';
import {
  compareVersions,
  findNextVersion,
  holesIn,
  upgradeTarget,
} from './version';

let site: RunningFixture;
afterEach(() => site?.stop());

/** A Next.js site whose code says which version it runs, the way real builds do. */
async function nextSite(code: string) {
  site = await startFixture({
    '/': {
      body: '<script src="/_next/static/chunks/main.js"></script><h1>Hi</h1>',
    },
    '/_next/static/chunks/main.js': { body: code },
  });
  return nextjsVersion.run({
    url: site.url,
    fetch: testFetchFor(site),
    platforms: [],
  });
}

// From Soundcheck's own live site, built with Turbopack.
const appRouterCode = (version: string) =>
  `n()}window.next={version:"${version}",appDir:!0},("function"==typeof n.default`;

describe('nextjs version check against a fake site', () => {
  it('reports an App Router site with React2Shell as critical', async () => {
    const result = await nextSite(appRouterCode('15.1.2'));

    expect(result).toMatchObject({ status: 'ran' });
    if (result.status !== 'ran') return;
    const [finding] = result.findings;
    expect(finding).toMatchObject({
      id: 'nextjs-version:outdated',
      severity: 'critical',
      title:
        'Your site runs Next.js 15.1.2, which has 5 known critical security holes',
      manualFix: { snippet: 'npm install next@15.5.28' },
    });
    expect(finding?.evidence[0]?.detail).toBe(
      'This file says your site runs Next.js 15.1.2.',
    );
    expect(finding?.evidence.map(({ detail }) => detail).join(' ')).toContain(
      'React2Shell',
    );
  });

  it('is high, not critical, when every hole needs a special setup', async () => {
    const result = await nextSite(appRouterCode('16.3.6'));

    expect(result).toMatchObject({
      status: 'ran',
      findings: [
        { severity: 'high', manualFix: { snippet: 'npm install next@16.4.1' } },
      ],
    });
  });

  it('is high for a Pages Router site, which React2Shell skips', async () => {
    const result = await nextSite(
      'let r="15.1.2";window.next={version:r,router:o,emitter:a}',
    );

    expect(result).toMatchObject({
      status: 'ran',
      findings: [{ severity: 'high' }],
    });
  });

  it('passes a site on a fixed version, like Soundcheck itself', async () => {
    expect(await nextSite(appRouterCode('16.4.4'))).toEqual({
      status: 'ran',
      findings: [],
    });
  });

  it("is skipped, never passed, when the version can't be read", async () => {
    expect(await nextSite('console.log("no version here")')).toMatchObject({
      status: 'skipped',
    });
  });

  it('has everything a finding needs', async () => {
    const result = await nextSite(appRouterCode('14.2.3'));

    if (result.status !== 'ran') throw new Error('did not run');
    for (const finding of result.findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.aiFix.request).toContain('Update Next.js');
    }
  });

  it('only runs on Next.js sites, for anyone', () => {
    expect(nextjsVersion.mode).toBe('url-passive');
    expect(nextjsVersion.platforms).toEqual(['nextjs']);
  });
});

describe('findNextVersion', () => {
  it('reads the version and router from the code', () => {
    expect(
      findNextVersion([{ location: 'a.js', text: appRouterCode('16.4.4') }]),
    ).toEqual({ version: '16.4.4', appRouter: true, location: 'a.js' });
  });

  it('ignores something that is not a version', () => {
    expect(
      findNextVersion([
        { location: 'a.js', text: 'window.next={version:"latest"}' },
      ]),
    ).toBeUndefined();
  });
});

describe('compareVersions', () => {
  it.each([
    ['15.1.9', '15.1.10', -1],
    ['16.0.0', '15.99.99', 1],
    ['16.1.0-canary.5', '16.1.0', -1],
    ['15.5.28', '15.5.28', 0],
  ])('%s vs %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});

describe('the advisory list', () => {
  const lines = [
    '11.1.4',
    '12.3.4',
    '13.5.6',
    '14.2.3',
    '15.0.0',
    '15.3.1',
    '15.5.10',
    '16.0.3',
    '16.2.4',
    '16.4.0',
  ];

  it.each(lines)('sends %s to a version with no known holes', (version) => {
    const target = upgradeTarget(holesIn(version));

    expect(target).toBeDefined();
    expect(holesIn(target ?? '')).toEqual([]);
  });

  it('has no fix that comes before the start of its own range', () => {
    for (const { ghsa, ranges } of ADVISORIES) {
      for (const { from, fixed } of ranges) {
        expect(compareVersions(fixed, from), ghsa).toBeGreaterThan(0);
      }
    }
  });

  it('flags nothing on the newest fixed versions', () => {
    expect(holesIn('16.4.1')).toEqual([]);
    expect(holesIn('15.5.28')).toEqual([]);
  });
});
