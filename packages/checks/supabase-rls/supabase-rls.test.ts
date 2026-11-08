import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_KEYS, PUBLIC_VALUES } from '../../../fixtures/bundle-secrets';
import {
  ANON_KEY,
  appCode,
  LEAKY_TABLES,
  leakyTables,
  PROTECTED_TABLES,
  protectedTables,
} from '../../../fixtures/supabase-rls';
import {
  startFixture,
  type FixtureSite,
  type RunningFixture,
} from '../../../fixtures/server';
import type { GuardedFetchOptions } from '../request-guard';
import { testFetchFor } from '../request-guard/test-fetch';
import type { CheckContext } from '../types';
import { supabaseRls } from './index';
import {
  findSupabaseProject,
  findTableNames,
  rowCount,
  tableKind,
} from './rules';

let site: RunningFixture;
afterEach(() => site?.stop());

interface Sent {
  path: string;
  options: GuardedFetchOptions;
}

/** Starts a fake app whose code points at its own fake database, and records each request. */
async function appWith(fixture: FixtureSite, tables: readonly string[]) {
  const pages: FixtureSite = { ...fixture };
  site = await startFixture(pages);
  pages['/assets/app.js'] = { body: appCode(site.url.slice(0, -1), tables) };
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

const toDatabase = (sent: readonly Sent[]) =>
  sent.filter(({ path }) => path.startsWith('/rest/v1/'));

describe('supabase RLS check against a fake app', () => {
  it('reports each table anyone can read, worst first', async () => {
    const { context } = await appWith(leakyTables, LEAKY_TABLES);

    const result = await supabaseRls.run(context);

    expect(result).toMatchObject({ status: 'ran' });
    if (result.status !== 'ran') return;
    expect(result.findings.map(({ id, severity }) => [id, severity])).toEqual([
      ['supabase-rls:readable-table:profiles', 'critical'],
      ['supabase-rls:readable-table:products', 'medium'],
    ]);
    expect(result.findings[0]?.evidence[0]?.detail).toBe(
      "We counted 1,240 rows using only the public key in your site's code. We didn't read any of them.",
    );
  });

  it('says it could not tell about tables with no visible rows', async () => {
    const { context } = await appWith(leakyTables, LEAKY_TABLES);

    const result = await supabaseRls.run(context);

    expect(result).toMatchObject({
      status: 'ran',
      note: expect.stringContaining('empty_table'),
    });
  });

  it('only ever asks for a count: HEAD requests, never row data', async () => {
    const { context, sent } = await appWith(leakyTables, LEAKY_TABLES);

    await supabaseRls.run(context);

    const requests = toDatabase(sent);
    expect(requests.length).toBe(LEAKY_TABLES.length);
    for (const { path, options } of requests) {
      expect(options.method, path).toBe('HEAD');
      expect(options.headers).toMatchObject({
        apikey: ANON_KEY,
        authorization: `Bearer ${ANON_KEY}`,
        prefer: 'count=exact',
      });
    }
  });

  it('never counts a file bucket as a table', async () => {
    const { context, sent } = await appWith(leakyTables, LEAKY_TABLES);

    await supabaseRls.run(context);

    expect(sent.map(({ path }) => path)).not.toContain('/rest/v1/avatars');
  });

  it('never puts the key in the report', async () => {
    const { context } = await appWith(leakyTables, LEAKY_TABLES);

    const result = await supabaseRls.run(context);

    expect(JSON.stringify(result)).not.toContain(ANON_KEY);
  });

  it('reports nothing when every table refuses the public key', async () => {
    const { context } = await appWith(protectedTables, PROTECTED_TABLES);

    expect(await supabaseRls.run(context)).toEqual({
      status: 'ran',
      findings: [],
    });
  });

  it('is skipped, never passed, when no table could be confirmed', async () => {
    const { context } = await appWith(leakyTables, ['empty_table']);

    expect(await supabaseRls.run(context)).toMatchObject({
      status: 'skipped',
    });
  });

  it('is skipped when the site has no Supabase project in its code', async () => {
    site = await startFixture({ '/': { body: '<h1>Hi</h1>' } });

    expect(
      await supabaseRls.run({
        url: site.url,
        fetch: testFetchFor(site),
        platforms: ['supabase'],
      }),
    ).toMatchObject({ status: 'skipped' });
  });

  it('has everything a finding needs', async () => {
    const { context } = await appWith(leakyTables, LEAKY_TABLES);

    const result = await supabaseRls.run(context);

    if (result.status !== 'ran') throw new Error('did not run');
    for (const finding of result.findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.manualFix.snippet).toContain('enable row level security');
      expect(finding.aiFix.request).toContain('Row Level Security');
    }
  });

  it('only runs for verified owners, on Supabase sites', () => {
    expect(supabaseRls.mode).toBe('url-active');
    expect(supabaseRls.platforms).toEqual(['supabase']);
  });
});

describe('finding the project', () => {
  const file = (text: string) => [{ location: 'https://app.test/a.js', text }];
  const URL = 'https://abcdefghijklmnopqrst.supabase.co';

  it('finds the project address and the anon key', () => {
    expect(
      findSupabaseProject(file(`createClient("${URL}", "${ANON_KEY}")`)),
    ).toEqual({ url: URL, key: ANON_KEY, isToken: true });
  });

  it('accepts the newer publishable key', () => {
    const key = PUBLIC_VALUES.supabasePublishable;

    expect(
      findSupabaseProject(file(`createClient("${URL}", "${key}")`)),
    ).toEqual({ url: URL, key, isToken: false });
  });

  it('uses the address the app was built with, like Lovable Cloud', () => {
    const key = PUBLIC_VALUES.supabasePublishable;
    const lovable =
      'https://c--0a1b2c3d-0000-4000-8000-000000000000-prod.lovable.cloud';
    // How a Lovable build ships its settings: an object, in backtick strings.
    const built = `{VITE_SUPABASE_PROJECT_ID:\`abcdefghijklmnopqrst\`,VITE_SUPABASE_PUBLISHABLE_KEY:\`${key}\`,VITE_SUPABASE_URL:\`${lovable}\`};createClient(e.VITE_SUPABASE_URL,t)`;

    expect(findSupabaseProject(file(built))).toEqual({
      url: lovable,
      key,
      isToken: false,
    });
  });

  it('prefers the address setting over another Supabase address in the code', () => {
    const custom = 'https://db.example-app.test';
    const text = `const docs="${URL}";const env={NEXT_PUBLIC_SUPABASE_URL:"${custom}"};createClient(env.NEXT_PUBLIC_SUPABASE_URL,"${ANON_KEY}")`;

    expect(findSupabaseProject(file(text))?.url).toBe(custom);
  });

  it('never uses a secret service role key, even if the site leaked one', () => {
    const leaked = file(
      `createClient("${URL}", "${FAKE_KEYS.supabaseServiceRole}")`,
    );

    expect(findSupabaseProject(leaked)).toBeUndefined();
  });
});

describe('finding table names', () => {
  it('reads .from() calls and skips storage buckets', () => {
    const text = [
      'a.from("profiles").select()',
      "a.from('orders')",
      'a.storage.from("avatars")',
      'a.from("profiles")',
    ].join(';');

    expect(findTableNames([{ location: 'x', text }])).toEqual([
      'profiles',
      'orders',
    ]);
  });
});

describe('rowCount', () => {
  it.each([
    ['0-24/1240', 1240],
    ['*/0', 0],
    ['*/*', undefined],
    [undefined, undefined],
  ])('reads %s as %s', (header, rows) => {
    expect(rowCount(header)).toBe(rows);
  });
});

describe('tableKind', () => {
  it.each([
    ['profiles', 'personal'],
    ['user_messages', 'personal'],
    ['orders', 'personal'],
    ['products', 'probably-public'],
    ['blog_posts', 'unknown'],
    ['widgets', 'unknown'],
  ])('treats %s as %s', (table, kind) => {
    expect(tableKind(table)).toBe(kind);
  });
});
