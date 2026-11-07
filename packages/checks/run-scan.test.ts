import type { ScanReport } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import { leftoverFilesSite } from '../../fixtures/leftover-files';
import { startFixture, type RunningFixture } from '../../fixtures/server';
import { checks } from './index';
import { testFetchFor } from './request-guard/test-fetch';
import type { Check, CheckResult } from './types';
import { NOT_ATTEMPTED, runScan } from './run-scan';

let site: RunningFixture;

afterEach(() => site?.stop());

const fakeCheck = (
  id: string,
  run: () => Promise<CheckResult>,
  overrides: Partial<Check> = {},
): Check => ({
  id,
  title: `Check ${id}`,
  mode: 'url-passive',
  platforms: 'all',
  run,
  ...overrides,
});

const passes = () =>
  Promise.resolve<CheckResult>({ status: 'ran', findings: [] });

async function scanFixture(scanChecks: readonly Check[], extra = {}) {
  site = await startFixture(leftoverFilesSite);
  return runScan(site.url, {
    fetch: testFetchFor(site),
    checks: scanChecks,
    ...extra,
  });
}

function reportOf(result: Awaited<ReturnType<typeof runScan>>): ScanReport {
  if (!result.ok) throw new Error(result.message);
  return result.report;
}

describe('runScan', () => {
  it('runs every real check against a site and builds a full report', async () => {
    const report = reportOf(await scanFixture(checks));

    expect(report.outcomes.map(({ checkId }) => checkId)).toEqual(
      checks.map(({ id }) => id),
    );
    expect(report.notAttempted).toEqual(NOT_ATTEMPTED);
    const leftovers = report.outcomes.find(
      ({ checkId }) => checkId === 'leftover-files',
    );
    expect(leftovers).toMatchObject({ status: 'ran' });
    if (leftovers?.status === 'ran') {
      expect(leftovers.findings.length).toBeGreaterThan(0);
    }
  });

  it('downloads each page once, however many checks read it', async () => {
    site = await startFixture(leftoverFilesSite);
    const visited: string[] = [];
    const fetch = testFetchFor(site);

    await runScan(site.url, {
      fetch: (target, options) => {
        visited.push(new URL(target).pathname);
        return fetch(target, options);
      },
      checks,
    });

    expect(visited.filter((path) => path === '/')).toHaveLength(1);
    expect(visited.filter((path) => path === '/assets/app.js')).toHaveLength(1);
  });

  it('says which checks it will run before running them, then reports each one', async () => {
    const events: string[] = [];

    await scanFixture([fakeCheck('a', passes), fakeCheck('b', passes)], {
      onPlanned: async (planned: { id: string }[]) => {
        events.push(`planned ${planned.map(({ id }) => id).join(',')}`);
      },
      onProgress: async (report: ScanReport) => {
        events.push(`progress ${report.outcomes.length}`);
      },
    });

    expect(events).toEqual(['planned a,b', 'progress 1', 'progress 2']);
  });

  it('fails the scan with a plain reason when the site can not be reached', async () => {
    site = await startFixture(leftoverFilesSite);
    await site.stop();
    const result = await runScan(site.url, {
      fetch: testFetchFor(site),
      checks: [fakeCheck('a', passes)],
    });
    site = await startFixture({});

    expect(result).toEqual({
      ok: false,
      message: 'We could not connect to this site.',
    });
  });

  it('reports a crashed check as not checked and keeps going', async () => {
    const report = reportOf(
      await scanFixture([
        fakeCheck('crashes', () => Promise.reject(new Error('boom'))),
        fakeCheck('after', passes),
      ]),
    );

    expect(report.outcomes).toEqual([
      expect.objectContaining({ checkId: 'crashes', status: 'skipped' }),
      expect.objectContaining({ checkId: 'after', status: 'ran' }),
    ]);
    expect(JSON.stringify(report)).not.toContain('boom');
  });

  it('stops waiting for a check that takes too long', async () => {
    const report = reportOf(
      await scanFixture(
        [
          fakeCheck('slow', () => new Promise(() => {})),
          fakeCheck('after', passes),
        ],
        { checkTimeLimitMs: 50 },
      ),
    );

    expect(report.outcomes[0]).toEqual({
      checkId: 'slow',
      title: 'Check slow',
      status: 'skipped',
      reason: 'This check took too long, so we stopped waiting for it.',
    });
    expect(report.outcomes[1]).toMatchObject({ status: 'ran' });
  });

  it('skips the checks left when the whole scan runs out of time', async () => {
    let clock = 0;
    const report = reportOf(
      await scanFixture(
        [
          fakeCheck('first', async () => {
            clock += 5_000;
            return { status: 'ran', findings: [] };
          }),
          fakeCheck('second', passes),
        ],
        { scanTimeLimitMs: 1_000, now: () => clock },
      ),
    );

    expect(report.outcomes.map(({ status }) => status)).toEqual([
      'ran',
      'skipped',
    ]);
  });

  it('only runs passive checks that apply to the platforms found', async () => {
    const report = reportOf(
      await scanFixture([
        fakeCheck('everyone', passes),
        fakeCheck('active', passes, { mode: 'url-active' }),
        fakeCheck('firebase-only', passes, { platforms: ['firebase'] }),
      ]),
    );

    expect(report.outcomes.map(({ checkId }) => checkId)).toEqual(['everyone']);
  });
});
