import { LESSONS } from '@soundcheck/report';
import { describe, expect, it } from 'vitest';
import {
  LEAKY_MIGRATIONS,
  SAFE_MIGRATIONS,
} from '../../../fixtures/supabase-policies';
import type { RepoFile } from '../repo';
import type { CheckContext } from '../types';
import { supabasePolicies } from './index';
import { judgeCondition } from './rules';
import { readSchema } from './schema';
import { splitStatements } from './sql';

const filesOf = (files: Record<string, string>): RepoFile[] =>
  Object.entries(files).map(([path, text]) => ({ path, text }));

const contextFor = (
  files: Record<string, string>,
  complete = true,
): CheckContext => ({
  fetch: async () => ({ ok: false, reason: 'timeout', message: 'unused' }),
  platforms: ['supabase'],
  repo: {
    repo: { owner: 'you', name: 'app' },
    files: filesOf(files),
    complete,
    filesSkipped: complete ? 0 : 1,
  },
});

async function findingsFor(files: Record<string, string>) {
  const result = await supabasePolicies.run(contextFor(files));
  if (result.status !== 'ran') throw new Error(`did not run: ${result.reason}`);
  return result.findings;
}

describe('Supabase policy check against real-looking migrations', () => {
  it('finds each mistake once, worst first', async () => {
    const findings = await findingsFor(LEAKY_MIGRATIONS);

    expect(findings.map(({ id, severity }) => [id, severity])).toEqual([
      ['supabase-policies:everyone-can-read:messages', 'critical'],
      ['supabase-policies:write-as-anyone:messages', 'critical'],
      ['supabase-policies:rls-off:orders', 'critical'],
      ['supabase-policies:any-user-can-read:profiles', 'critical'],
      ['supabase-policies:trusts-user-metadata:reports', 'critical'],
      ['supabase-policies:trusts-user-metadata:role', 'critical'],
    ]);
  });

  it('points at the file and line of each mistake', async () => {
    const findings = await findingsFor(LEAKY_MIGRATIONS);
    const where = (id: string) =>
      findings.find((finding) => finding.id === id)?.evidence[0];

    expect(where('supabase-policies:any-user-can-read:profiles')).toMatchObject(
      {
        kind: 'file',
        path: 'supabase/migrations/20250101000000_init.sql',
        line: 12,
      },
    );
    expect(where('supabase-policies:rls-off:orders')).toMatchObject({
      line: 22,
    });
  });

  it('leaves alone a product list anyone may read, a table fixed by a later migration, and other schemas', async () => {
    const ids = (await findingsFor(LEAKY_MIGRATIONS)).map(({ id }) => id);

    expect(ids.some((id) => id.endsWith(':products'))).toBe(false);
    expect(ids.some((id) => id.endsWith(':notes'))).toBe(false);
    expect(await findingsFor(SAFE_MIGRATIONS)).toEqual([]);
  });

  it('ignores a policy written inside a function body', () => {
    const schema = readSchema(filesOf(LEAKY_MIGRATIONS));

    expect([...(schema.tables.get('products')?.policies.keys() ?? [])]).toEqual(
      ['public products'],
    );
  });

  it('is skipped, not passed, when the repo has no migrations', async () => {
    expect(
      await supabasePolicies.run(contextFor({ 'src/app.ts': 'export {}' })),
    ).toMatchObject({ status: 'skipped' });
  });

  it('says so when part of the repo was too big to read', async () => {
    expect(
      await supabasePolicies.run(contextFor(SAFE_MIGRATIONS, false)),
    ).toMatchObject({
      status: 'ran',
      note: expect.stringContaining('too big'),
    });
  });

  it('has everything a finding needs', async () => {
    for (const finding of await findingsFor(LEAKY_MIGRATIONS)) {
      expect(LESSONS[finding.lessonId], finding.id).toBeDefined();
      expect(finding.source).toBe('code');
      expect(finding.manualFix.language).toBe('sql');
      expect(finding.aiFix.request.length).toBeGreaterThan(50);
    }
  });

  it('reads code, only for Supabase projects', () => {
    expect(supabasePolicies.mode).toBe('repo');
    expect(supabasePolicies.platforms).toEqual(['supabase']);
  });
});

describe('judgeCondition', () => {
  it.each([
    ['true', 'always'],
    ['(true)', 'always'],
    ['auth.uid() is not null', 'any-signed-in-user'],
    ['( select auth.uid() ) IS NOT NULL', 'any-signed-in-user'],
    ["auth.role() = 'authenticated'", 'any-signed-in-user'],
    ['(select auth.uid()) = user_id', 'other'],
    ["(auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'", 'user-metadata'],
    ['exists (select 1 from members m where m.user_id = auth.uid())', 'other'],
  ])('%s is %s', (expression, condition) => {
    expect(judgeCondition(expression)).toBe(condition);
  });
});

describe('splitStatements', () => {
  it("doesn't split inside strings, quoted names, or function bodies", () => {
    const sql = `select 'a;b'; create table "x;y" (id int);\ncreate function f() returns int as $body$ select 1; $body$;`;

    expect(splitStatements(sql).map(({ text }) => text)).toEqual([
      "select 'a;b'",
      'create table "x;y" (id int)',
      'create function f() returns int as $body$ select 1; $body$',
    ]);
  });

  it('drops comments and counts lines', () => {
    expect(splitStatements('-- hi\n/* a;\nb */\nselect 1;')).toEqual([
      { text: 'select 1', line: 4 },
    ]);
  });
});
