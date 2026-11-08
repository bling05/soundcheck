import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEAKY_BUCKETS,
  leakyBuckets,
  storageAppCode,
} from '../../../fixtures/supabase-storage';
import { ANON_KEY } from '../../../fixtures/supabase-rls';
import {
  startFixture,
  type FixtureSite,
  type RunningFixture,
} from '../../../fixtures/server';
import type { GuardedFetchOptions } from '../request-guard';
import { testFetchFor } from '../request-guard/test-fetch';
import type { CheckContext } from '../types';
import { supabaseStorage } from './index';
import { bucketKind, entryCount, findBucketNames } from './rules';

let site: RunningFixture;
afterEach(() => site?.stop());

interface Sent {
  path: string;
  options: GuardedFetchOptions;
}

/** Starts a fake app whose code points at its own fake storage, and records each request. */
async function appWith(fixture: FixtureSite, buckets: readonly string[]) {
  const pages: FixtureSite = { ...fixture };
  site = await startFixture(pages);
  pages['/assets/app.js'] = {
    body: storageAppCode(site.url.slice(0, -1), buckets),
  };
  const sent: Sent[] = [];
  const fetch = testFetchFor(site);
  const context: CheckContext = {
    url: site.url,
    platforms: ['supabase'],
    fetch: (target, options = {}) => {
      sent.push({ path: new URL(target).pathname, options });
      return fetch(target, options);
    },
  };
  return { context, sent };
}

const toStorage = (sent: readonly Sent[]) =>
  sent.filter(({ path }) => path.startsWith('/storage/'));

describe('supabase storage check against a fake app', () => {
  it('reports each bucket anyone can list, worst first', async () => {
    const { context } = await appWith(leakyBuckets, LEAKY_BUCKETS);

    const result = await supabaseStorage.run(context);

    expect(result).toMatchObject({ status: 'ran' });
    if (result.status !== 'ran') return;
    expect(result.findings.map(({ id, severity }) => [id, severity])).toEqual([
      ['supabase-storage:listable-bucket:id-documents', 'critical'],
      ['supabase-storage:listable-bucket:product-images', 'medium'],
    ]);
    expect(result.findings.map(({ evidence }) => evidence[0]?.detail)).toEqual([
      "We could see the names of 37 files and folders using only the public key in your site's code. We didn't open or save any of them.",
      "We could see the names of at least 100 files and folders using only the public key in your site's code. We didn't open or save any of them.",
    ]);
  });

  it('says it could not tell about a bucket that showed no files', async () => {
    const { context } = await appWith(leakyBuckets, LEAKY_BUCKETS);

    expect(await supabaseStorage.run(context)).toMatchObject({
      status: 'ran',
      note: expect.stringContaining('protected: empty.'),
    });
  });

  it('only asks for one page of names, and never downloads a file', async () => {
    const { context, sent } = await appWith(leakyBuckets, LEAKY_BUCKETS);

    await supabaseStorage.run(context);

    const requests = toStorage(sent);
    expect(requests.map(({ path }) => path)).toEqual(
      LEAKY_BUCKETS.map((bucket) => `/storage/v1/object/list/${bucket}`),
    );
    for (const { options } of requests) {
      expect(options).toMatchObject({
        method: 'POST',
        json: { prefix: '', limit: 100, offset: 0 },
        headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` },
      });
    }
  });

  it('never puts file names or the key in the report', async () => {
    const { context } = await appWith(leakyBuckets, LEAKY_BUCKETS);

    const report = JSON.stringify(await supabaseStorage.run(context));

    expect(report).not.toContain('jane-doe');
    expect(report).not.toContain(ANON_KEY);
  });

  it('never lists a table as if it were a bucket', async () => {
    const { context, sent } = await appWith(leakyBuckets, LEAKY_BUCKETS);

    await supabaseStorage.run(context);

    expect(sent.map(({ path }) => path)).not.toContain(
      '/storage/v1/object/list/profiles',
    );
  });

  it('is skipped, never passed, when every bucket showed nothing', async () => {
    const { context } = await appWith(leakyBuckets, ['empty']);

    expect(await supabaseStorage.run(context)).toMatchObject({
      status: 'skipped',
    });
  });

  it('reports nothing when every bucket refuses the public key', async () => {
    const { context } = await appWith(leakyBuckets, ['avatars']);

    expect(await supabaseStorage.run(context)).toEqual({
      status: 'ran',
      findings: [],
    });
  });

  it('is skipped when the code uses no storage', async () => {
    const { context } = await appWith(leakyBuckets, []);

    expect(await supabaseStorage.run(context)).toMatchObject({
      status: 'skipped',
    });
  });

  it('has everything a finding needs', async () => {
    const { context } = await appWith(leakyBuckets, LEAKY_BUCKETS);

    const result = await supabaseStorage.run(context);

    if (result.status !== 'ran') throw new Error('did not run');
    for (const finding of result.findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.manualFix.snippet).toContain('storage.objects');
      expect(finding.aiFix.request).toContain('storage bucket');
    }
  });

  it('only runs for verified owners, on Supabase sites', () => {
    expect(supabaseStorage.mode).toBe('url-active');
    expect(supabaseStorage.platforms).toEqual(['supabase']);
  });
});

describe('finding bucket names', () => {
  it('reads storage.from() calls and file links, and skips tables', () => {
    const text = [
      'e.storage.from(`avatars`).upload(f)',
      'a.from("profiles").select()',
      '"https://x.supabase.co/storage/v1/object/public/receipts/a.png"',
      'e.storage.from("avatars")',
    ].join(';');

    expect(findBucketNames([{ location: 'x', text }])).toEqual([
      'avatars',
      'receipts',
    ]);
  });
});

describe('entryCount', () => {
  it.each([
    ['[{"name":"a"},{"name":"b"}]', 2],
    ['[]', 0],
    ['{"error":"nope"}', undefined],
    ['<html>', undefined],
  ])('reads %s as %s', (body, count) => {
    expect(entryCount(body)).toBe(count);
  });
});

describe('bucketKind', () => {
  it.each([
    ['id-documents', 'personal'],
    ['verification-selfies', 'personal'],
    ['receipts', 'personal'],
    ['product-images', 'probably-public'],
    ['public', 'probably-public'],
    ['avatars', 'unknown'],
    ['uploads', 'unknown'],
  ])('treats %s as %s', (bucket, kind) => {
    expect(bucketKind(bucket)).toBe(kind);
  });
});
