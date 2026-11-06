import { afterEach, describe, expect, it } from 'vitest';
import {
  FAKE_KEYS,
  leakySite,
  publicKeysSite,
  PUBLIC_VALUES,
} from '../../../fixtures/bundle-secrets';
import { startFixture, type RunningFixture } from '../../../fixtures/server';
import type { GuardedFetch } from '../request-guard';
import { testFetchFor } from '../request-guard/test-fetch';
import type { CheckContext } from '../types';
import { bundleSecrets } from './index';
import { findLeaks } from './rules';

const leaksIn = (text: string, location = 'https://site.test/app.js') =>
  findLeaks([{ location, text }]);

/** A pretend site, for answers a local fixture can't produce. */
function contextFor(
  pages: Record<
    string,
    { status?: number; body?: string; truncated?: boolean }
  >,
  overrides: Partial<CheckContext> = {},
): CheckContext {
  const fetch: GuardedFetch = async (url) =>
    ({
      ok: true,
      status: 200,
      headers: {},
      body: Buffer.from(pages[new URL(url).pathname]?.body ?? ''),
      url,
      truncated: false,
      ...(pages[new URL(url).pathname]?.status !== undefined && {
        status: pages[new URL(url).pathname]?.status,
      }),
      ...(pages[new URL(url).pathname]?.truncated && { truncated: true }),
    }) as Awaited<ReturnType<GuardedFetch>>;
  return { url: 'https://site.test/', fetch, platforms: [], ...overrides };
}

async function findingsFor(context: CheckContext) {
  const result = await bundleSecrets.run(context);
  if (result.status !== 'ran') throw new Error(result.reason);
  return result.findings;
}

describe('bundle secrets check against fixture sites', () => {
  let site: RunningFixture;

  afterEach(() => site.stop());

  it('reports a secret key in a code file on the vulnerable site', async () => {
    site = await startFixture(leakySite);

    const findings = await findingsFor({
      url: site.url,
      fetch: testFetchFor(site),
      platforms: [],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkId: 'bundle-secrets',
      severity: 'critical',
      source: 'live',
      title: "Your Stripe secret key is in your site's public code",
    });
    expect(findings[0]?.evidence[0]).toMatchObject({
      kind: 'url',
      url: `${site.url}assets/app.js`,
    });
  });

  it('reports nothing on the site with only public keys', async () => {
    site = await startFixture(publicKeysSite);

    const result = await bundleSecrets.run({
      url: site.url,
      fetch: testFetchFor(site),
      platforms: [],
    });

    expect(result).toEqual({ status: 'ran', findings: [] });
  });
});

describe('findLeaks catches', () => {
  it.each([
    [
      'a Supabase service role key',
      FAKE_KEYS.supabaseServiceRole,
      'supabase-secret',
    ],
    [
      'a new-style Supabase secret key',
      FAKE_KEYS.supabaseSecret,
      'supabase-secret',
    ],
    ['a Stripe secret key', FAKE_KEYS.stripeSecret, 'stripe-secret'],
    ['a Stripe restricted key', FAKE_KEYS.stripeRestricted, 'stripe-secret'],
    ['a private key', FAKE_KEYS.privateKey, 'private-key'],
    ['an OpenAI project key', FAKE_KEYS.openaiProject, 'openai-key'],
    ['an older OpenAI key', FAKE_KEYS.openaiLegacy, 'openai-key'],
    ['an Anthropic key', FAKE_KEYS.anthropic, 'anthropic-key'],
    ['an AWS key ID', FAKE_KEYS.aws, 'aws-key'],
  ])('%s', (_name, key, rule) => {
    const leaks = leaksIn(`const key = "${key}";`);

    expect(leaks.map((leak) => leak.rule)).toEqual([rule]);
  });

  it('a private key written with real line breaks', () => {
    const key = FAKE_KEYS.privateKey.replaceAll('\\n', '\n');

    expect(leaksIn(key).map((leak) => leak.rule)).toEqual(['private-key']);
  });
});

describe('findLeaks does not flag', () => {
  it.each([
    ['the Supabase anon key', PUBLIC_VALUES.supabaseAnon],
    ['a logged-in user token', PUBLIC_VALUES.supabaseUser],
    [
      'the published local Supabase default',
      PUBLIC_VALUES.supabaseLocalDefault,
    ],
    ['a Supabase publishable key', PUBLIC_VALUES.supabasePublishable],
    ['a Stripe publishable key', PUBLIC_VALUES.stripePublishable],
    ['a Stripe test key', PUBLIC_VALUES.stripeTest],
    ['a Google browser key', PUBLIC_VALUES.googleBrowserKey],
    ['a token that cannot be decoded', 'eyJhbGci.eyJub3Rqc29u.c2ln'],
    ['a CSS class', 'sk-circle-fade-dot-animation-with-a-long-name'],
    ['a library constant', '"-----BEGIN PRIVATE KEY-----"'],
    ['a word that merely ends in sk', `task-${'a1B2c3D4'.repeat(6)}`],
  ])('%s', (_name, text) => {
    expect(leaksIn(text)).toEqual([]);
  });

  it.each([
    ['sk_' + 'live_your_stripe_secret_key_here'],
    ['sk_' + 'live_' + 'YourSecretKey0123456789ab'],
    ['sk_' + 'live_' + 'x'.repeat(24)],
    ['sk_' + 'live_' + 'abc'.repeat(8)],
    ['AKIA' + 'IOSFODNN7' + 'EXAMPLE'],
    ['sk-' + 'proj-' + 'placeholder'.repeat(5)],
  ])('the placeholder %s', (text) => {
    expect(leaksIn(text)).toEqual([]);
  });
});

describe('findLeaks groups results', () => {
  it('reports one key in several files once, naming each file', () => {
    const key = FAKE_KEYS.stripeSecret;

    const leaks = findLeaks([
      { location: 'https://site.test/a.js', text: key },
      { location: 'https://site.test/b.js', text: `${key} ${key}` },
    ]);

    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.locations).toEqual([
      'https://site.test/a.js',
      'https://site.test/b.js',
    ]);
  });

  it('reports two different keys separately', () => {
    const leaks = leaksIn(
      `${FAKE_KEYS.stripeSecret} ${FAKE_KEYS.stripeRestricted}`,
    );

    expect(leaks).toHaveLength(2);
  });

  it('puts results in the same order whatever order the code is in', () => {
    const first = leaksIn(`${FAKE_KEYS.aws} ${FAKE_KEYS.stripeSecret}`);
    const second = leaksIn(`${FAKE_KEYS.stripeSecret} ${FAKE_KEYS.aws}`);

    expect(first.map((leak) => leak.rule)).toEqual([
      'stripe-secret',
      'aws-key',
    ]);
    expect(second.map((leak) => leak.rule)).toEqual([
      'stripe-secret',
      'aws-key',
    ]);
  });
});

describe('when the check cannot get a real answer', () => {
  it('passes along the reason when the site could not be reached', async () => {
    const fetch: GuardedFetch = async () => ({
      ok: false,
      reason: 'timeout',
      message: 'The site took too long to respond.',
    });

    const result = await bundleSecrets.run({
      url: 'https://site.test/',
      fetch,
      platforms: [],
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'The site took too long to respond.',
    });
  });

  it('skips when the home page is an error', async () => {
    const result = await bundleSecrets.run(
      contextFor({ '/': { status: 403, body: 'Blocked' } }),
    );

    expect(result).toMatchObject({ status: 'skipped' });
  });

  it('skips when it has no link', async () => {
    const result = await bundleSecrets.run({
      ...contextFor({}),
      url: undefined,
    });

    expect(result).toMatchObject({ status: 'skipped' });
  });

  it('skips rather than passes when it read only part of a clean site', async () => {
    const result = await bundleSecrets.run(
      contextFor({
        '/': { body: '<script src="/gone.js"></script>' },
        '/gone.js': { status: 404 },
      }),
    );

    expect(result).toMatchObject({ status: 'skipped' });
  });

  it('still reports what it found on a partly read site, with a note', async () => {
    const result = await bundleSecrets.run(
      contextFor({
        '/': {
          body: `<script src="/gone.js"></script><script>"${FAKE_KEYS.stripeSecret}"</script>`,
        },
        '/gone.js': { status: 404 },
      }),
    );

    expect(result).toMatchObject({ status: 'ran' });
    if (result.status === 'ran') {
      expect(result.findings).toHaveLength(1);
      expect(result.note).toContain("couldn't read all");
    }
  });
});

describe('finding contents', () => {
  const everyKey = Object.values(FAKE_KEYS).join(' ');
  const leakyContext = (overrides: Partial<CheckContext> = {}) =>
    contextFor({ '/': { body: `<script>${everyKey}</script>` } }, overrides);

  it('never includes a full key, only its last 4 characters', async () => {
    const findings = await findingsFor(leakyContext());

    expect(findings.length).toBeGreaterThanOrEqual(7);
    const output = JSON.stringify(findings);
    for (const key of Object.values(FAKE_KEYS)) {
      expect(output).not.toContain(key);
      expect(output).not.toContain(key.slice(0, -4));
    }
    expect(output).toContain(`****${FAKE_KEYS.stripeSecret.slice(-4)}`);
  });

  it('leaves query strings out of the evidence', async () => {
    const fetch: GuardedFetch = async (url) => ({
      ok: true,
      status: 200,
      headers: {},
      body: Buffer.from(FAKE_KEYS.stripeSecret),
      url,
      truncated: false,
    });

    const findings = await findingsFor({
      url: 'https://site.test/?token=fake-secret',
      fetch,
      platforms: [],
    });

    expect(JSON.stringify(findings)).not.toContain('fake-secret');
  });

  it('has everything a finding needs', async () => {
    for (const finding of await findingsFor(leakyContext())) {
      expect(finding.lesson.whatItIs).not.toBe('');
      expect(finding.lesson.whyAiToolsProduceIt).not.toBe('');
      expect(finding.lesson.howItIsExploited).not.toBe('');
      expect(finding.lesson.owasp.length).toBeGreaterThan(0);
      expect(finding.lesson.cwe.length).toBeGreaterThan(0);
      expect(finding.manualFix.snippet).not.toBe('');
    }
  });

  it('tells people to replace the key, not just remove it', async () => {
    for (const finding of await findingsFor(leakyContext())) {
      expect(finding.manualFix.description).toContain('Create a new key');
      expect(finding.manualFix.description).toContain('Delete the old key');
      expect(finding.aiFix.request).toContain('delete the old one');
      expect(finding.safetyStep).toContain('Create a new key');
    }
  });

  it('gives each key an id from its type and last 4 characters', async () => {
    const findings = await findingsFor(
      contextFor({
        '/': { body: `<script>"${FAKE_KEYS.stripeSecret}"</script>` },
      }),
    );

    expect(findings.map(({ id }) => id)).toEqual([
      `bundle-secrets:stripe-secret:****${FAKE_KEYS.stripeSecret.slice(-4)}`,
    ]);
  });

  it('keeps the same id on every scan, whatever file the key moves to', async () => {
    const key = `"${FAKE_KEYS.stripeSecret}"`;
    const inPage = await findingsFor(
      contextFor({ '/': { body: `<script>${key}</script>` } }),
    );
    const inFile = await findingsFor(
      contextFor({
        '/': { body: '<script src="/app.js"></script>' },
        '/app.js': { body: key },
      }),
    );

    expect(inFile.map(({ id }) => id)).toEqual(inPage.map(({ id }) => id));
  });

  it('gives different keys with the same last 4 characters different ids', async () => {
    const lookalike = FAKE_KEYS.stripeSecret.replace('live_0', 'live_9');
    const findings = await findingsFor(
      contextFor({
        '/': {
          body: `<script>"${FAKE_KEYS.stripeSecret}" "${lookalike}"</script>`,
        },
      }),
    );

    const ids = findings.map(({ id }) => id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('never puts a full key in an id', async () => {
    const findings = await findingsFor(leakyContext());

    for (const { id } of findings) {
      for (const key of Object.values(FAKE_KEYS)) {
        expect(id).not.toContain(key.slice(0, -4));
      }
    }
  });

  it('uses no em dashes in anything a user reads', async () => {
    const findings = await findingsFor(leakyContext());

    expect(JSON.stringify(findings)).not.toContain('—');
  });
});
