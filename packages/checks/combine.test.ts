import type { Finding } from '@soundcheck/report';
import { describe, expect, it } from 'vitest';
import { combineChecks } from './combine';
import { checks, databaseRules, storageRules } from './index';
import type { Check, CheckContext, CheckResult } from './types';

const finding = (id: string, severity: Finding['severity']): Finding => ({
  id,
  checkId: id.split(':')[0] ?? id,
  title: id,
  severity,
  source: 'live',
  evidence: [],
  lessonId: 'security-headers:content-security-policy',
  manualFix: { description: '', language: 'text', snippet: '' },
  aiFix: { problem: id, request: '' },
});

const part = (
  platform: 'supabase' | 'firebase',
  result: CheckResult,
): Check => ({
  id: `${platform}-part`,
  title: platform,
  mode: 'url-active',
  platforms: [platform],
  run: async () => result,
});

const context = (platforms: CheckContext['platforms']): CheckContext => ({
  url: 'https://site.test/',
  fetch: async () => ({ ok: false, reason: 'timeout', message: 'unused' }),
  platforms,
});

const combined = combineChecks('database-rules', 'Databases', [
  {
    name: 'Supabase',
    check: part('supabase', {
      status: 'ran',
      findings: [finding('supabase-rls:readable-table:x', 'medium')],
    }),
  },
  {
    name: 'Firebase',
    check: part('firebase', {
      status: 'skipped',
      reason: 'No Firebase project found.',
    }),
  },
]);

describe('combineChecks', () => {
  it("runs only the part for the site's platform, unchanged", async () => {
    expect(await combined.run(context(['supabase']))).toEqual({
      status: 'ran',
      findings: [
        {
          ...finding('supabase-rls:readable-table:x', 'medium'),
          checkId: 'database-rules',
        },
      ],
    });
  });

  it('keeps finding ids, but files them under the combined check for rescans', async () => {
    const result = await combined.run(context(['supabase']));

    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings[0]).toMatchObject({
      id: 'supabase-rls:readable-table:x',
      checkId: 'database-rules',
    });
  });

  it("passes a part's skip through as it is", async () => {
    expect(await combined.run(context(['firebase']))).toEqual({
      status: 'skipped',
      reason: 'No Firebase project found.',
    });
  });

  it('names each platform when a site uses both', async () => {
    expect(await combined.run(context(['supabase', 'firebase']))).toMatchObject(
      {
        status: 'ran',
        note: 'Firebase: No Firebase project found.',
      },
    );
  });

  it('runs on either platform, only for verified owners', () => {
    expect(databaseRules).toMatchObject({
      id: 'database-rules',
      mode: 'url-active',
      platforms: ['supabase', 'firebase'],
    });
    expect(storageRules).toMatchObject({
      id: 'storage-rules',
      platforms: ['supabase', 'firebase'],
    });
  });

  it('lists the checks in number order', () => {
    expect(checks.map(({ id }) => id)).toEqual([
      'security-headers',
      'bundle-secrets',
      'leftover-files',
      'database-rules',
      'storage-rules',
      'nextjs-version',
      'supabase-policies',
      'ownership-checks',
      'repo-secrets',
      'slopsquatting',
      'payments',
    ]);
  });

  it('refuses parts that run in different modes', () => {
    expect(() =>
      combineChecks('mixed', 'Mixed', [
        {
          name: 'A',
          check: {
            ...part('supabase', { status: 'ran', findings: [] }),
            mode: 'url-passive',
          },
        },
        { name: 'B', check: part('firebase', { status: 'ran', findings: [] }) },
      ]),
    ).toThrow('same mode');
  });
});
