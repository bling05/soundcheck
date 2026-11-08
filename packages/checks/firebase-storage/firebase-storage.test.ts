import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import { firebasePage } from '../../../fixtures/firebase-rules';
import {
  startFixture,
  type FixtureResponse,
  type FixtureSite,
  type RunningFixture,
} from '../../../fixtures/server';
import type { GuardedFetchOptions } from '../request-guard';
import { testFetchFor } from '../request-guard/test-fetch';
import {
  createFirebaseStorage,
  detailFor,
  findFolders,
  firebaseStorage,
} from './index';

let site: RunningFixture;
afterEach(() => site?.stop());

const BUCKET = 'soundcheck-fixture.firebasestorage.app';
const LIST = `/v0/b/${BUCKET}/o`;

/** A page of names, with personal-looking ones to prove none are kept. */
const names = (count: number, more = false): FixtureResponse => ({
  body: JSON.stringify({
    items: Array.from({ length: count }, (_, index) => ({
      name: `id-documents/jane-doe-passport-${index}.jpg`,
      bucket: BUCKET,
    })),
    ...(more && { nextPageToken: 'next' }),
  }),
});
const denied: FixtureResponse = {
  status: 403,
  body: '{"error":{"code":403,"message":"Permission denied."}}',
};

const CODE = [
  'uploadBytes(ref(storage, "id-documents/" + uid), file);',
  'uploadBytes(ref(storage, `product-images/${name}`), file);',
  'storageRef.child("avatars/me.png");',
].join('\n');

interface Sent {
  url: string;
  options: GuardedFetchOptions;
}

/**
 * Runs the check on a fake Firebase app. The fixture server matches paths only, so the
 * folder being listed is passed through `answers`, keyed by the `prefix` query.
 */
async function appWith(
  answers: Record<string, FixtureResponse>,
  { code = CODE, bucket = true } = {},
) {
  const pages: FixtureSite = {};
  site = await startFixture(pages);
  const config = bucket ? `storageBucket: "${BUCKET}",` : '';
  pages['/'] = {
    body: firebasePage(undefined, `const x = { ${config} };\n${code}`),
  };
  const sent: Sent[] = [];
  const fetch = testFetchFor(site);
  const check = createFirebaseStorage(site.url.slice(0, -1));
  const result = await check.run({
    url: site.url,
    platforms: ['firebase'],
    fetch: (url, options = {}) => {
      sent.push({ url, options });
      if (url.includes(LIST)) {
        const prefix = new URL(url).searchParams.get('prefix') ?? '';
        const answer = answers[prefix] ?? denied;
        pages[LIST] = answer;
      }
      return fetch(url, options);
    },
  });
  return { result, sent };
}

const ids = (result: Awaited<ReturnType<typeof appWith>>['result']) =>
  result.status === 'ran'
    ? result.findings.map(({ id, severity }) => [id, severity])
    : result;

describe('firebase storage check against a fake app', () => {
  it('reports a whole bucket anyone can list, once, as critical', async () => {
    const { result, sent } = await appWith({ '': names(4) });

    expect(ids(result)).toEqual([
      ['firebase-storage:listable:root', 'critical'],
    ]);
    expect(sent.filter(({ url }) => url.includes(LIST))).toHaveLength(1);
  });

  it('reports each listable folder when the bucket itself is locked', async () => {
    const { result } = await appWith({
      'id-documents/': names(37),
      'product-images/': names(100, true),
    });

    expect(ids(result)).toEqual([
      ['firebase-storage:listable:id-documents', 'critical'],
      ['firebase-storage:listable:product-images', 'medium'],
    ]);
  });

  it('passes an app whose storage is locked everywhere', async () => {
    const { result } = await appWith({});

    expect(result).toEqual({ status: 'ran', findings: [] });
  });

  it('only lists one page of names, and never downloads a file', async () => {
    const { sent } = await appWith({ 'id-documents/': names(3) });

    for (const { url, options } of sent.filter(({ url }) =>
      url.includes(LIST),
    )) {
      const query = new URL(url).searchParams;
      expect(query.get('maxResults')).toBe('100');
      expect(query.get('delimiter')).toBe('/');
      expect(options.method ?? 'GET').toBe('GET');
      expect(url).not.toContain('alt=media');
    }
  });

  it('never puts file names in the report', async () => {
    const { result } = await appWith({ 'id-documents/': names(3) });

    expect(JSON.stringify(result)).not.toContain('jane-doe');
  });

  it('says it only partly checked when the code names no folders', async () => {
    const { result } = await appWith({}, { code: '' });

    expect(result).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('storage folders'),
    });
  });

  it('is skipped when the config has no storage bucket', async () => {
    const { result } = await appWith({}, { bucket: false });

    expect(result).toMatchObject({ status: 'skipped' });
  });

  it('has everything a finding needs', async () => {
    const { result } = await appWith({
      'id-documents/': names(2),
      'product-images/': names(2),
    });

    if (result.status !== 'ran') throw new Error('did not run');
    for (const finding of result.findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.manualFix.snippet).toContain('allow');
      expect(finding.aiFix.request).toContain('storage rules');
    }
  });

  it('only runs for verified owners, on Firebase sites', () => {
    expect(firebaseStorage.mode).toBe('url-active');
    expect(firebaseStorage.platforms).toEqual(['firebase']);
  });
});

describe('findFolders', () => {
  it('reads the first folder of every storage path the code uses', () => {
    const text = [
      'ref(storage, "avatars/" + uid)',
      '(0,s.ref)(st,`receipts/${id}.pdf`)',
      'root.child("uploads/a.png")',
      'P="docs/x.pdf";ref(storage,P)',
      'ref(rtdb, "notes")',
    ].join(';');

    expect(findFolders([{ location: 'x', text }])).toEqual([
      'avatars',
      'receipts',
      'uploads',
      'docs',
    ]);
  });
});

describe('detailFor', () => {
  it.each([
    [37, false, 'the names of 37 files and folders'],
    [100, true, 'at least 100 files and folders'],
    [1, false, '1 file or folder'],
    [0, false, "It's empty right now"],
  ])('%s, more: %s', (entries, more, text) => {
    expect(detailFor(entries, more)).toContain(text);
  });
});
