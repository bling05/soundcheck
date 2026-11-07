import { LESSONS, type Finding } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import {
  missingSecurityHeaders,
  secureSecurityHeaders,
} from '../../../fixtures/security-headers';
import { startFixture, type RunningFixture } from '../../../fixtures/server';
import type { GuardedFetch } from '../request-guard';
import { testFetchFor } from '../request-guard/test-fetch';
import type { CheckContext } from '../types';
import { securityHeaders } from './index';
import { findProblems } from './rules';

const STRONG = {
  'content-security-policy': "default-src 'self'",
  'strict-transport-security': 'max-age=31536000',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
};

function without(headers: Record<string, string>, name: string) {
  return Object.fromEntries(
    Object.entries(headers).filter(([header]) => header !== name),
  );
}

const rulesFor = (headers: Record<string, string>, body = '') =>
  findProblems(headers, body).map(({ rule }) => rule);

function contextFor(
  response: Partial<{
    status: number;
    headers: Record<string, string>;
    url: string;
  }>,
  overrides: Partial<CheckContext> = {},
): CheckContext {
  const fetch: GuardedFetch = async (url) => ({
    ok: true,
    status: 200,
    headers: STRONG,
    body: Buffer.from(''),
    url,
    truncated: false,
    ...response,
  });
  return { url: 'https://site.test/', fetch, platforms: [], ...overrides };
}

async function findingsFor(context: CheckContext): Promise<Finding[]> {
  const result = await securityHeaders.run(context);
  if (result.status !== 'ran') throw new Error(result.reason);
  return result.findings;
}

describe('security headers check against fixture sites', () => {
  let site: RunningFixture;

  afterEach(() => site.stop());

  it('reports all four problems on the vulnerable site', async () => {
    site = await startFixture(missingSecurityHeaders);

    const findings = await findingsFor({
      url: site.url,
      fetch: testFetchFor(site),
      platforms: [],
    });

    expect(findings.map(({ title }) => title)).toEqual([
      "Your site doesn't limit which scripts can run",
      "Your site doesn't force browsers to use HTTPS",
      'Other websites can embed your site inside theirs',
      "Browsers may guess what your site's files are",
    ]);
  });

  it('reports nothing on the clean site', async () => {
    site = await startFixture(secureSecurityHeaders);

    const result = await securityHeaders.run({
      url: site.url,
      fetch: testFetchFor(site),
      platforms: [],
    });

    expect(result).toEqual({ status: 'ran', findings: [] });
  });
});

describe('script policy rule', () => {
  const rule = 'content-security-policy';
  const withPolicy = (policy: string) => ({
    ...STRONG,
    'content-security-policy': policy,
  });

  it.each([
    ["default-src 'self'"],
    ["script-src 'self'"],
    ["default-src *; script-src 'self'"], // script-src is the one that applies
    ["DEFAULT-SRC 'SELF'"],
  ])('accepts %s', (policy) => {
    expect(rulesFor(withPolicy(policy))).not.toContain(rule);
  });

  it.each([['*'], ['https:'], ['http:']])(
    'rejects scripts allowed from %s',
    (source) => {
      expect(rulesFor(withPolicy(`script-src ${source}`))).toContain(rule);
      expect(rulesFor(withPolicy(`default-src ${source}`))).toContain(rule);
    },
  );

  it('rejects a policy with only frame rules, which does not limit scripts', () => {
    expect(rulesFor(withPolicy("frame-ancestors 'none'"))).toContain(rule);
  });

  it('does not count report-only as protection, and says so', () => {
    const rest = without(STRONG, 'content-security-policy');
    const headers = {
      ...rest,
      'content-security-policy-report-only': "default-src 'self'",
    };

    const [problem] = findProblems(headers, '');

    expect(problem?.rule).toBe(rule);
    expect(problem?.detail).toContain('report-only');
  });

  it.each([
    [
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`,
    ],
    [`<meta content="script-src 'self'" http-equiv='content-security-policy'>`],
  ])('accepts a policy inside the page: %s', (body) => {
    const rest = without(STRONG, 'content-security-policy');

    expect(rulesFor(rest, body)).toEqual([]);
  });

  it('is not fooled by a page that only mentions the header', () => {
    const rest = without(STRONG, 'content-security-policy');

    expect(
      rulesFor(rest, '<p>We read about Content-Security-Policy</p>'),
    ).toContain(rule);
  });
});

describe('HTTPS rule', () => {
  const rule = 'strict-transport-security';
  const withValue = (value: string) => ({
    ...STRONG,
    'strict-transport-security': value,
  });

  it.each([
    ['max-age=15552000'],
    ['max-age=63072000; includeSubDomains; preload'],
    ['MAX-AGE="31536000"'],
  ])('accepts %s', (value) => {
    expect(rulesFor(withValue(value))).not.toContain(rule);
  });

  it.each([['max-age=0'], ['max-age=15551999'], ['includeSubDomains']])(
    'rejects %s',
    (value) => {
      expect(rulesFor(withValue(value))).toContain(rule);
    },
  );
});

describe('frame protection rule', () => {
  const rule = 'frame-protection';
  const withoutFrameHeader = without(STRONG, 'x-frame-options');

  it.each([['DENY'], ['deny'], ['SAMEORIGIN'], ['DENY, DENY']])(
    'accepts X-Frame-Options %s',
    (value) => {
      expect(rulesFor({ ...STRONG, 'x-frame-options': value })).not.toContain(
        rule,
      );
    },
  );

  it.each([['ALLOW-FROM https://a.test'], ['nonsense'], ['DENY, nonsense']])(
    'rejects X-Frame-Options %s',
    (value) => {
      expect(rulesFor({ ...STRONG, 'x-frame-options': value })).toContain(rule);
    },
  );

  it.each([["'none'"], ["'self'"], ['https://partner.test']])(
    'accepts frame-ancestors %s with no X-Frame-Options',
    (sources) => {
      const headers = {
        ...withoutFrameHeader,
        'content-security-policy': `default-src 'self'; frame-ancestors ${sources}`,
      };

      expect(rulesFor(headers)).toEqual([]);
    },
  );

  it('lets a wide-open frame-ancestors rule override X-Frame-Options', () => {
    const headers = {
      ...STRONG,
      'content-security-policy': "default-src 'self'; frame-ancestors *",
    };

    expect(rulesFor(headers)).toContain(rule);
  });

  it('ignores frame-ancestors inside the page, as browsers do', () => {
    const rest = without(withoutFrameHeader, 'content-security-policy');
    const body = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; frame-ancestors 'none'">`;

    expect(rulesFor(rest, body)).toEqual([rule]);
  });
});

describe('content type rule', () => {
  const rule = 'content-type-options';

  it.each([['nosniff'], ['NoSniff'], ['nosniff, nosniff']])(
    'accepts %s',
    (value) => {
      expect(
        rulesFor({ ...STRONG, 'x-content-type-options': value }),
      ).not.toContain(rule);
    },
  );

  it('rejects any other value', () => {
    expect(
      rulesFor({ ...STRONG, 'x-content-type-options': 'sniff' }),
    ).toContain(rule);
  });
});

describe('when the check cannot get a real answer', () => {
  it.each([[403], [404], [500], [503]])(
    'skips instead of passing or failing on error %i',
    async (status) => {
      const result = await securityHeaders.run(
        contextFor({ status, headers: {} }),
      );

      expect(result).toMatchObject({ status: 'skipped' });
    },
  );

  it('passes along the reason when the site could not be reached', async () => {
    const fetch: GuardedFetch = async () => ({
      ok: false,
      reason: 'timeout',
      message: 'The site took too long to respond.',
    });

    const result = await securityHeaders.run({
      url: 'https://site.test/',
      fetch,
      platforms: [],
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'The site took too long to respond.',
    });
  });

  it('skips when it has no link', async () => {
    const result = await securityHeaders.run({
      ...contextFor({}),
      url: undefined,
    });

    expect(result).toMatchObject({ status: 'skipped' });
  });
});

describe('finding contents', () => {
  it('has everything a finding needs, tagged as seen on the live site', async () => {
    const findings = await findingsFor(contextFor({ headers: {} }));

    for (const finding of findings) {
      expect(finding).toMatchObject({
        checkId: 'security-headers',
        source: 'live',
      });
      expect(finding.evidence[0]).toMatchObject({ kind: 'header' });
      // Every finding of one kind shares a lesson named after its check and rule.
      expect(finding.id.startsWith(`${finding.lessonId}:`)).toBe(true);
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.manualFix.snippet).not.toBe('');
      expect(finding.aiFix.problem).toBe(finding.title);
      expect(finding.aiFix.request).not.toBe('');
    }
  });

  it.each([
    [['nextjs', 'vercel'], 'next.config'],
    [['vercel'], 'vercel.json'],
    [['vite'], 'hosting or framework settings'],
    [undefined, 'hosting or framework settings'],
  ] as const)('with %j, says to look in %s', async (technologies, where) => {
    const findings = await findingsFor(
      contextFor({ headers: {} }, { technologies }),
    );

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.manualFix.description).toContain(where);
    }
  });

  it('gives each problem an id from its rule and page, the same on every scan', async () => {
    const first = await findingsFor(contextFor({ headers: {} }));
    const second = await findingsFor(contextFor({ headers: {} }));

    expect(first.map(({ id }) => id)).toEqual([
      'security-headers:content-security-policy:/',
      'security-headers:strict-transport-security:/',
      'security-headers:frame-protection:/',
      'security-headers:content-type-options:/',
    ]);
    expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
  });

  it('uses the page the site ended up on, without its query string', async () => {
    const findings = await findingsFor(
      contextFor({ headers: {}, url: 'https://site.test/home?ref=ad' }),
    );

    expect(findings[0]?.id).toBe(
      'security-headers:content-security-policy:/home',
    );
  });

  it('uses no em dashes in anything a user reads', async () => {
    const findings = await findingsFor(contextFor({ headers: {} }));

    expect(JSON.stringify(findings)).not.toContain('—');
  });

  it('never repeats the site header text or query string in a finding', async () => {
    const findings = await findingsFor(
      contextFor({
        url: 'https://site.test/?token=fake-secret',
        headers: {
          'content-security-policy':
            'upgrade-insecure-requests; report-to fake-secret',
          'x-frame-options': 'fake-secret',
          'x-content-type-options': 'fake-secret',
          'strict-transport-security': 'fake-secret',
        },
      }),
    );

    expect(findings).toHaveLength(4);
    expect(JSON.stringify(findings)).not.toContain('fake-secret');
  });
});
