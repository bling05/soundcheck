import { LESSONS } from '@soundcheck/report';
import { describe, expect, it } from 'vitest';
import { FAKE_KEYS } from '../../../fixtures/bundle-secrets';
import type { RepoFile } from '../repo';
import type { CheckContext } from '../types';
import { repoSecrets } from './index';
import { findCommittedSecrets, findEnvFiles, findIgnoreGap } from './rules';

const filesFrom = (files: Record<string, string>): RepoFile[] =>
  Object.entries(files).map(([path, text]) => ({ path, text }));

const contextFor = (
  files: Record<string, string>,
  complete = true,
): CheckContext => ({
  fetch: async () => ({ ok: false, reason: 'timeout', message: 'unused' }),
  platforms: [],
  repo: {
    repo: { owner: 'you', name: 'app' },
    files: filesFrom(files),
    complete,
    filesSkipped: complete ? 0 : 1,
  },
});

async function findingsFor(files: Record<string, string>, complete = true) {
  const result = await repoSecrets.run(contextFor(files, complete));
  if (result.status !== 'ran') throw new Error('did not run');
  return result;
}

// Assembled from pieces, like the other fake keys, so no scanner mistakes this file for a leak.
const PASSWORD = 'Kx9' + 'mP2vL8qRt';
const NEON_URL = `postgresql://app:${PASSWORD}@ep-cool-sun-123.us-east-2.aws.neon.tech/neondb`;
const GITIGNORE = 'node_modules\n.env\n';

describe('committed keys', () => {
  it('finds each key once, with every file and line it is on', () => {
    const secrets = findCommittedSecrets(
      filesFrom({
        'lib/stripe.ts': `import Stripe from 'stripe';\n\nexport const stripe = new Stripe('${FAKE_KEYS.stripeSecret}');`,
        'scripts/seed.ts': `// same key\nconst key = "${FAKE_KEYS.stripeSecret}";`,
        'ai.py': `client = OpenAI(api_key="${FAKE_KEYS.openaiProject}")`,
      }),
    );
    expect(secrets).toEqual([
      {
        rule: 'stripe-secret',
        redacted: expect.stringMatching(/EF01$/),
        places: [
          { path: 'lib/stripe.ts', line: 3 },
          { path: 'scripts/seed.ts', line: 2 },
        ],
      },
      {
        rule: 'openai-key',
        redacted: expect.stringMatching(/c3D4$/),
        places: [{ path: 'ai.py', line: 1 }],
      },
    ]);
  });

  it('never puts the full key in a finding', async () => {
    const { findings } = await findingsFor({
      'lib/stripe.ts': `const key = '${FAKE_KEYS.stripeSecret}';`,
      'db.ts': `const url = '${NEON_URL}';`,
      '.gitignore': GITIGNORE,
    });
    const text = JSON.stringify(findings);
    expect(text).not.toContain(FAKE_KEYS.stripeSecret);
    expect(text).not.toContain(PASSWORD);
    expect(findings.map(({ title }) => title)).toEqual([
      'Your Stripe secret key is in your public repo',
      'Your database password is in your public repo',
    ]);
  });

  it('skips Google keys, which Firebase config commits on purpose', () => {
    expect(
      findCommittedSecrets(
        filesFrom({ 'firebase.ts': `apiKey: "${FAKE_KEYS.googleApiKey}"` }),
      ),
    ).toEqual([]);
  });
});

describe('database passwords', () => {
  it.each([
    ['a real database host', NEON_URL, 1],
    [
      'the computer you work on',
      `postgres://app:${PASSWORD}@localhost:5432/app`,
      0,
    ],
    ['a local Docker database', `postgresql://app:${PASSWORD}@db:5432/app`, 0],
    [
      'a host reserved for testing',
      `postgres://app:${PASSWORD}@db.fixture.test/app`,
      0,
    ],
    [
      'a default password',
      'postgres://postgres:postgres@db.example.com/app',
      0,
    ],
    [
      'a docs placeholder',
      'postgresql://postgres:[YOUR-PASSWORD]@db.abc.supabase.co:5432/postgres',
      0,
    ],
    [
      'a template',
      'mongodb+srv://app:${DB_PASSWORD}@cluster0.mongodb.net/app',
      0,
    ],
  ])('%s', (_name, url, count) => {
    expect(
      findCommittedSecrets(filesFrom({ 'config.ts': `const url = "${url}";` })),
    ).toHaveLength(count);
  });
});

describe('.env files', () => {
  const ENV = [
    '# Public, meant for the browser',
    'NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.public',
    'SUPABASE_SERVICE_ROLE_KEY="' + 'a8Fj2kLq' + 'P0zXw3Rt"',
    'export RESEND_API_KEY=re_' + 'Zt83kQp1mNv',
    'LOCAL_DATABASE_URL=postgres://postgres:postgres@localhost:5432/app',
    'STRIPE_WEBHOOK_SECRET=',
    'OPENAI_API_KEY=your-key-here',
  ].join('\n');

  it('names the secret settings in a committed .env file, not their values', () => {
    expect(
      findEnvFiles(filesFrom({ '.env': ENV, 'apps/web/.env.local': ENV })),
    ).toEqual([
      {
        path: '.env',
        line: 4,
        names: ['SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'],
      },
      {
        path: 'apps/web/.env.local',
        line: 4,
        names: ['SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'],
      },
    ]);
  });

  it('leaves example files alone', () => {
    expect(
      findEnvFiles(
        filesFrom({
          '.env.example': ENV,
          '.env.sample': ENV,
          '.env.local.template': ENV,
        }),
      ),
    ).toEqual([]);
  });

  it('reports the file, and not the missing .gitignore line too', async () => {
    const { findings } = await findingsFor({
      '.env': ENV,
      'app.ts': 'process.env.X',
    });
    expect(findings).toMatchObject([
      {
        title: 'A .env file with secret settings is in your public repo',
        severity: 'high',
        evidence: [{ path: '.env', line: 4 }],
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain('Zt83kQp1mNv');
  });
});

describe('.gitignore', () => {
  it.each([
    ['ignores .env', { '.gitignore': GITIGNORE }, undefined],
    [
      'ignores only .env*.local, as some Next.js templates do',
      { '.gitignore': '.env*.local' },
      undefined,
    ],
    [
      'never mentions .env',
      { '.gitignore': 'node_modules\n# .env\n' },
      { kind: 'not-ignored', path: '.gitignore' },
    ],
    ['is missing', {}, { kind: 'no-gitignore' }],
  ])('a project that reads env vars and %s', (_name, files, gap) => {
    expect(
      findIgnoreGap(
        filesFrom({
          ...files,
          'src/config.ts': 'const key = process.env.API_KEY;',
        }),
      ),
    ).toEqual(gap);
  });

  it("doesn't care about projects that never read env vars", () => {
    expect(
      findIgnoreGap(filesFrom({ 'index.html': '<h1>Hi</h1>' })),
    ).toBeUndefined();
  });
});

describe('the check', () => {
  it('passes a clean repo', async () => {
    expect(
      await findingsFor({
        '.gitignore': GITIGNORE,
        '.env.example':
          'STRIPE_SECRET_KEY=\nDATABASE_URL=postgres://user:password@localhost/app',
        'lib/stripe.ts': 'new Stripe(process.env.STRIPE_SECRET_KEY)',
      }),
    ).toEqual({ status: 'ran', findings: [] });
  });

  it('says when some files were too big to read', async () => {
    expect(await findingsFor({ '.gitignore': GITIGNORE }, false)).toMatchObject(
      {
        note: expect.stringContaining('too big'),
      },
    );
  });

  it('has everything a finding needs', async () => {
    const { findings } = await findingsFor({
      'a.ts': Object.values(FAKE_KEYS).join('\n') + `\n${NEON_URL}`,
      '.env': 'API_TOKEN=' + 'q8Wm2Lx' + 'Pz4Kd',
    });
    expect(findings.map(({ lessonId }) => lessonId)).toEqual([
      'repo-secrets:supabase-secret',
      'repo-secrets:supabase-secret',
      'repo-secrets:stripe-secret',
      'repo-secrets:stripe-secret',
      'repo-secrets:private-key',
      'repo-secrets:database-url',
      'repo-secrets:openai-key',
      'repo-secrets:openai-key',
      'repo-secrets:anthropic-key',
      'repo-secrets:aws-key',
      'repo-secrets:env-file',
    ]);
    for (const finding of findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.source).toBe('code');
      expect(finding.safetyStep).toContain('history');
    }
    expect(new Set(findings.map(({ id }) => id)).size).toBe(findings.length);
  });

  it('runs on any repo', () => {
    expect(repoSecrets).toMatchObject({ mode: 'repo', platforms: 'all' });
  });
});

it('still reads hosts that merely end in the same letters', () => {
  const url = `postgres://app:${PASSWORD}@db.latest/app`;
  expect(
    findCommittedSecrets(filesFrom({ 'config.ts': `const url = "${url}";` })),
  ).toHaveLength(1);
});
