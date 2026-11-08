import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_CODE,
  FIREBASE_KEY,
  firebasePage,
  lockedFirestore,
  mixedFirestore,
  openRealtime,
  pathOpenRealtime,
  PROJECT_ID,
  testModeFirestore,
} from '../../../fixtures/firebase-rules';
import {
  startFixture,
  type FixtureSite,
  type RunningFixture,
} from '../../../fixtures/server';
import type { GuardedFetchOptions } from '../request-guard';
import { testFetchFor } from '../request-guard/test-fetch';
import { createFirebaseRules, firebaseRules } from './index';
import {
  findCollectionNames,
  findFirebaseProject,
  findRealtimePaths,
} from './rules';

let site: RunningFixture;
afterEach(() => site?.stop());

interface Sent {
  url: string;
  options: GuardedFetchOptions;
}

/** Starts a fake Firebase app whose databases run on the same fake server. */
async function appWith(
  databases: FixtureSite,
  { realtime = false, code = APP_CODE } = {},
) {
  const pages: FixtureSite = { ...databases };
  site = await startFixture(pages);
  pages['/'] = {
    body: firebasePage(realtime ? `${site.url}rtdb` : undefined, code),
  };
  const sent: Sent[] = [];
  const fetch = testFetchFor(site);
  const check = createFirebaseRules(site.url.slice(0, -1));
  const result = await check.run({
    url: site.url,
    platforms: ['firebase'],
    fetch: (url, options = {}) => {
      sent.push({ url, options });
      return fetch(url, options);
    },
  });
  return { result, sent };
}

const ids = (result: Awaited<ReturnType<typeof appWith>>['result']) =>
  result.status === 'ran'
    ? result.findings.map(({ id, severity }) => [id, severity])
    : result;

describe('firebase rules check against a fake app', () => {
  it('reports test mode once, as critical', async () => {
    const { result } = await appWith(testModeFirestore);

    expect(ids(result)).toEqual([
      ['firebase-rules:firestore-open', 'critical'],
    ]);
  });

  it('reports each open collection when the rules are only partly open', async () => {
    const { result } = await appWith(mixedFirestore);

    expect(ids(result)).toEqual([
      ['firebase-rules:readable-collection:users', 'critical'],
      ['firebase-rules:readable-collection:products', 'medium'],
    ]);
    if (result.status !== 'ran') return;
    expect(result.findings[0]?.evidence[0]?.detail).toBe(
      "We could see at least 100 documents using only the public settings in your site's code. We didn't read what's in them.",
    );
  });

  it('passes a fully locked app', async () => {
    const { result } = await appWith(lockedFirestore);

    expect(result).toEqual({ status: 'ran', findings: [] });
  });

  it('reports an open Realtime Database root, and stops there', async () => {
    const { result, sent } = await appWith(
      { ...lockedFirestore, ...openRealtime },
      { realtime: true },
    );

    expect(ids(result)).toEqual([
      ['firebase-rules:realtime-open:root', 'critical'],
    ]);
    expect(sent.some(({ url }) => url.includes('/rtdb/notes'))).toBe(false);
  });

  it('reports an open Realtime Database path the code reads', async () => {
    const { result } = await appWith(
      { ...lockedFirestore, ...pathOpenRealtime },
      { realtime: true },
    );

    expect(ids(result)).toEqual([
      ['firebase-rules:realtime-open:notes', 'critical'],
    ]);
  });

  it('only reads names: no fields from Firestore, shallow from the Realtime Database', async () => {
    const { sent } = await appWith(
      { ...mixedFirestore, ...pathOpenRealtime },
      { realtime: true },
    );

    for (const { url, options } of sent.filter(({ url }) =>
      url.includes('/v1/'),
    )) {
      const query = new URL(url).searchParams;
      expect(query.get('mask.fieldPaths')).toBe('__name__');
      expect(query.get('key')).toBe(FIREBASE_KEY);
      expect(options.method ?? 'GET').toBe('GET');
    }
    for (const { url } of sent.filter(({ url }) => url.includes('/rtdb/'))) {
      expect(new URL(url).searchParams.get('shallow')).toBe('true');
    }
  });

  it('never puts document names in the report', async () => {
    const { result } = await appWith(mixedFirestore);

    expect(JSON.stringify(result)).not.toContain('jane.doe');
  });

  it('says it only partly checked when it finds no collection names', async () => {
    const { result } = await appWith(lockedFirestore, { code: '' });

    expect(result).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('collection names'),
    });
  });

  it('treats a project that never turned Firestore on as having none, not as locked', async () => {
    const disabled = {
      status: 403,
      body: '{"error":{"code":403,"status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}',
    };
    const { result, sent } = await appWith({
      '/v1/projects/soundcheck-fixture/databases/(default)/documents/soundcheck-rules-check':
        disabled,
    });

    expect(result).toMatchObject({ status: 'skipped' });
    expect(sent.filter(({ url }) => url.includes('/v1/'))).toHaveLength(1);
  });

  it('has everything a finding needs', async () => {
    for (const databases of [testModeFirestore, mixedFirestore]) {
      const { result } = await appWith(databases);
      if (result.status !== 'ran') throw new Error('did not run');
      for (const finding of result.findings) {
        expect(LESSONS[finding.lessonId]).toBeDefined();
        expect(finding.manualFix.snippet).toContain('allow');
        expect(finding.aiFix.request).toContain('rules');
      }
      await site.stop();
    }
  });

  it('only runs for verified owners, on Firebase sites', () => {
    expect(firebaseRules.mode).toBe('url-active');
    expect(firebaseRules.platforms).toEqual(['firebase']);
  });
});

describe('finding the project', () => {
  it('reads the config object', () => {
    const text = firebasePage('https://x-default-rtdb.firebaseio.com/', '');

    expect(findFirebaseProject([{ location: 'x', text }])).toEqual({
      projectId: PROJECT_ID,
      apiKey: FIREBASE_KEY,
      databaseUrl: 'https://x-default-rtdb.firebaseio.com',
    });
  });

  it('reads it written as JSON', () => {
    const text = `{"projectId":"${PROJECT_ID}","apiKey":"${FIREBASE_KEY}"}`;

    expect(findFirebaseProject([{ location: 'x', text }])).toMatchObject({
      projectId: PROJECT_ID,
    });
  });
});

describe('finding names', () => {
  it('reads collection calls in every common shape', () => {
    const text = [
      'collection(db, "users")',
      '(0,r.collection)(o,"orders")',
      'doc(db, "carts", id)',
      'db.collection("legacy")',
      'C="events";collection(db,C)',
      'collection(db, "__internal__")',
    ].join(';');

    expect(findCollectionNames([{ location: 'x', text }])).toEqual([
      'users',
      'orders',
      'carts',
      'legacy',
      'events',
    ]);
  });

  it('reads Realtime Database paths', () => {
    const text = 'ref(rtdb, "notes");db.ref("scores");ref(rtdb, "a/b")';

    expect(findRealtimePaths([{ location: 'x', text }])).toEqual([
      'notes',
      'scores',
    ]);
  });
});
