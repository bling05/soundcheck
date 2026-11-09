import { LESSONS } from '@soundcheck/report';
import { describe, expect, it } from 'vitest';
import type { GuardedFetch, GuardedFetchResult } from '../request-guard';
import type { CheckContext } from '../types';
import { createSlopsquatting } from './index';
import { findDependencies } from './dependencies';
import { lookalikeOf, oneTypoApart } from './lookalike';
import { normalizePythonName } from './manifests';
import { coversWholePackage } from './osv';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const daysAgo = (days: number) =>
  new Date(NOW - days * 86_400_000).toISOString();

type Answer = { status: number; json?: unknown; truncated?: boolean } | 'down';

const OSV_BATCH = 'https://api.osv.dev/v1/querybatch';

/** A fake registry: each address answers as listed, anything else is a 404. OSV finds nothing by default. */
function fakeRegistry(answers: Record<string, Answer>) {
  const asked: string[] = [];
  const fetch: GuardedFetch = async (url) => {
    asked.push(url);
    const answer = answers[url] ??
      (url === OSV_BATCH
        ? { status: 200, json: { results: [] } }
        : undefined) ?? {
        status: 404,
        json: { error: 'Not found' },
      };
    if (answer === 'down')
      return { ok: false, reason: 'timeout', message: 'slow' };
    const result: GuardedFetchResult = {
      ok: true,
      status: answer.status,
      headers: {},
      body: Buffer.from(JSON.stringify(answer.json ?? {})),
      url,
      truncated: answer.truncated ?? false,
    };
    return result;
  };
  return { fetch, asked };
}

const npm = (name: string) =>
  `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
const pypi = (name: string) => `https://pypi.org/pypi/${name}/json`;
const OLD_NPM = {
  status: 200,
  json: { 'dist-tags': { latest: '4.0.0' }, time: { created: daysAgo(3000) } },
};

const contextFor = (
  files: Record<string, string>,
  fetch: GuardedFetch,
): CheckContext => ({
  fetch,
  platforms: [],
  repo: {
    repo: { owner: 'you', name: 'app' },
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
    complete: true,
    filesSkipped: 0,
  },
});

const check = createSlopsquatting({ now: () => NOW });

async function run(
  files: Record<string, string>,
  answers: Record<string, Answer>,
) {
  const registry = fakeRegistry(answers);
  const result = await check.run(contextFor(files, registry.fetch));
  return { result, asked: registry.asked };
}

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'my-app',
    dependencies: {
      react: '^19.0.0',
      'react-auth-helpers-pro': '^1.2.0',
      crossenv: '^6.0.0',
      'fresh-thing': '1.0.0',
      ui: 'workspace:*',
      'local-lib': 'file:../lib',
      'from-github': 'someone/repo#main',
      aliased: 'npm:lodash@^4',
    },
    devDependencies: { '@acme/internal': '1.0.0' },
  },
  null,
  2,
);

describe('reading the repo', () => {
  it('lists packages from the registry, once each, and skips local, git, and own packages', () => {
    const deps = findDependencies([
      { path: 'package.json', text: PACKAGE_JSON },
      {
        path: 'packages/ui/package.json',
        text: '{"name":"ui","dependencies":{"react":"19.0.0"}}',
      },
    ]);
    expect(
      deps.map(({ name, places }) => [
        name,
        places.map((p) => `${p.path}:${p.line}`),
      ]),
    ).toEqual([
      ['react', ['package.json:4', 'packages/ui/package.json:1']],
      ['react-auth-helpers-pro', ['package.json:5']],
      ['crossenv', ['package.json:6']],
      ['fresh-thing', ['package.json:7']],
      ['lodash', ['package.json:11']],
      ['@acme/internal', ['package.json:14']],
    ]);
  });

  it('reads requirements files and pyproject.toml, with PyPI names normalized', () => {
    const deps = findDependencies([
      {
        path: 'requirements.txt',
        text: '# web\nDjango>=5.0\nrequests[socks]==2.32  # http\n-r dev.txt\n-e .\ngit+https://github.com/x/y.git\nmy_pkg @ https://example.com/p.whl\nPyYAML ; python_version > "3.8"\n',
      },
      {
        path: 'pyproject.toml',
        text: '[project]\nname = "my-tool"\ndependencies = [\n  "httpx>=0.27",\n  "rich[jupyter]",\n]\n\n[tool.poetry.dependencies]\npython = "^3.12"\nFlask_Login = "^0.6"\nlocal = { path = "../local" }\n',
      },
    ]);
    expect(
      deps.map(
        ({ name, places }) => `${name} ${places[0]?.path}:${places[0]?.line}`,
      ),
    ).toEqual([
      'django requirements.txt:2',
      'requests requirements.txt:3',
      'pyyaml requirements.txt:8',
      'httpx pyproject.toml:4',
      'rich pyproject.toml:5',
      'flask-login pyproject.toml:10',
    ]);
  });

  it('knows which names may come from a private registry', () => {
    const deps = findDependencies([
      {
        path: 'package.json',
        text: '{"dependencies":{"@acme/ui":"1","@other/ui":"1"}}',
      },
      { path: '.npmrc', text: '@acme:registry=https://npm.acme.dev/\n' },
      {
        path: 'requirements.txt',
        text: '--extra-index-url https://pypi.acme.dev/simple\nacme-utils\n',
      },
    ]);
    expect(deps.map(({ name, maybePrivate }) => [name, maybePrivate])).toEqual([
      ['@acme/ui', true],
      ['@other/ui', false],
      ['acme-utils', true],
    ]);
  });

  it.each([
    ['Flask_Login', 'flask-login'],
    ['zope.interface', 'zope-interface'],
    ['PyYAML', 'pyyaml'],
  ])('calls %s %s on PyPI', (written, normal) => {
    expect(normalizePythonName(written)).toBe(normal);
  });
});

describe('the check', () => {
  const answers: Record<string, Answer> = {
    [npm('react')]: { status: 200, json: {}, truncated: true },
    [npm('lodash')]: OLD_NPM,
    [npm('crossenv')]: {
      status: 200,
      json: {
        'dist-tags': { latest: '0.0.2-security' },
        time: { created: daysAgo(3000) },
      },
    },
    [npm('fresh-thing')]: {
      status: 200,
      json: {
        'dist-tags': { latest: '1.0.0' },
        time: { created: daysAgo(12) },
      },
    },
    'https://api.npmjs.org/downloads/point/last-week/fresh-thing': {
      status: 200,
      json: { downloads: 31 },
    },
  };

  it('reports made-up, malware, and brand-new packages, and nothing else', async () => {
    const { result } = await run({ 'package.json': PACKAGE_JSON }, answers);
    if (result.status !== 'ran') throw new Error('did not run');
    expect(
      result.findings.map(({ title, severity, evidence }) => [
        severity,
        title,
        evidence[0]?.kind === 'file' && evidence[0].line,
      ]),
    ).toEqual([
      ['critical', 'npm removed crossenv for containing malware', 6],
      [
        'high',
        "react-auth-helpers-pro doesn't exist on npm, so anyone could publish it",
        5,
      ],
      ['medium', 'fresh-thing is brand new on npm and barely used', 7],
      [
        'medium',
        "@acme/internal doesn't exist on npm, so anyone could publish it",
        14,
      ],
    ]);
    expect(result.findings[2]?.evidence[0]?.detail).toContain(
      '12 days ago and had 31 downloads',
    );
    for (const finding of result.findings) {
      expect(LESSONS[finding.lessonId]).toBeDefined();
      expect(finding.source).toBe('code');
    }
    expect(result.findings[0]?.safetyStep).toContain('stolen');
  });

  it('leaves a new package alone once plenty of people use it', async () => {
    const { result } = await run(
      { 'package.json': '{"dependencies":{"fresh-thing":"1"}}' },
      {
        ...answers,
        'https://api.npmjs.org/downloads/point/last-week/fresh-thing': {
          status: 200,
          json: { downloads: 9000 },
        },
      },
    );
    expect(result).toEqual({ status: 'ran', findings: [] });
  });

  it('only asks for download counts of new packages', async () => {
    const { asked } = await run(
      { 'package.json': '{"dependencies":{"lodash":"4","react":"19"}}' },
      answers,
    );
    expect(asked.filter((url) => url.includes('downloads'))).toEqual([]);
  });

  it('checks PyPI too', async () => {
    const { result } = await run(
      { 'requirements.txt': 'django\nhuggingface-cli\nbrand-new-lib\n' },
      {
        [pypi('django')]: { status: 200, json: {}, truncated: true },
        [pypi('brand-new-lib')]: {
          status: 200,
          json: { releases: { '0.1': [{ upload_time_iso_8601: daysAgo(3) }] } },
        },
      },
    );
    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings.map(({ title }) => title)).toEqual([
      "huggingface-cli doesn't exist on PyPI, so anyone could publish it",
      'brand-new-lib is brand new on PyPI and barely used',
    ]);
  });

  it('calls a missing name from a private registry worth checking, not made up', async () => {
    const { result } = await run(
      {
        'package.json': '{"dependencies":{"@acme/ui":"1"}}',
        '.npmrc': '@acme:registry=https://npm.acme.dev/',
      },
      {},
    );
    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings).toMatchObject([
      {
        title: "@acme/ui isn't on the public npm registry",
        severity: 'medium',
      },
    ]);
  });

  it("says how many packages it couldn't look up, and skips when it couldn't look up any", async () => {
    const files = {
      'package.json': '{"dependencies":{"lodash":"4","left-pad":"1"}}',
    };
    const some = await run(files, {
      [npm('lodash')]: OLD_NPM,
      [npm('left-pad')]: 'down',
    });
    expect(some.result).toMatchObject({
      status: 'ran',
      findings: [],
      note: expect.stringContaining("couldn't check 1 of your 2"),
    });
    const none = await run(files, {
      [npm('lodash')]: 'down',
      [npm('left-pad')]: 'down',
    });
    expect(none.result).toMatchObject({ status: 'skipped' });
  });

  it('skips a repo with no packages, and runs on any repo', async () => {
    const { result } = await run({ 'index.html': '<h1>Hi</h1>' }, {});
    expect(result.status).toBe('skipped');
    expect(check).toMatchObject({ mode: 'repo', platforms: 'all' });
  });
});

describe('install commands and imports', () => {
  const README = [
    '# My app',
    '```bash',
    'npm install react-auth-helpers-pro@2 --save-dev',
    'npm install <package>',
    'pnpm add -w @acme/ui zod',
    'npx create-thing-cli my-app --yes',
    'pip install -r requirements.txt reqeusts "rich[jupyter]>=13"',
    'pip install ./local-folder git+https://github.com/x/y.git',
    '```',
  ].join('\n');

  it('finds packages in docs, scripts, and CI, and skips placeholders, flags, paths, and links', () => {
    const deps = findDependencies([
      { path: 'README.md', text: README },
      {
        path: 'Dockerfile',
        text: 'FROM python:3.12\nRUN pip install --no-cache-dir flask==3.0',
      },
      {
        path: '.github/workflows/ci.yml',
        text: 'steps:\n  - run: npm i -g vercel && npm test',
      },
      {
        path: 'src/app.ts',
        text: '// mentions npm install not-from-code-files\nexport {};',
      },
    ]);
    expect(
      deps.map(
        ({ ecosystem, name, places }) =>
          `${ecosystem}:${name} ${places[0]?.path}:${places[0]?.line} ${places[0]?.source}`,
      ),
    ).toEqual([
      'npm:react-auth-helpers-pro README.md:3 install-command',
      'npm:@acme/ui README.md:5 install-command',
      'npm:zod README.md:5 install-command',
      'npm:create-thing-cli README.md:6 install-command',
      'pypi:reqeusts README.md:7 install-command',
      'pypi:rich README.md:7 install-command',
      'pypi:flask Dockerfile:2 install-command',
      'npm:vercel .github/workflows/ci.yml:2 install-command',
    ]);
  });

  it('finds imports no package.json lists, and skips built-ins, aliases, and local folders', () => {
    const deps = findDependencies([
      {
        path: 'package.json',
        text: '{"name":"web","dependencies":{"react":"19"}}',
      },
      {
        path: 'tsconfig.json',
        text: '{"compilerOptions":{"paths":{"@ui/*":["./src/ui/*"]}}}',
      },
      { path: 'src/utils/date.ts', text: 'export const x = 1;' },
      {
        path: 'src/page.tsx',
        text: [
          "import React from 'react';",
          "import { readFile } from 'node:fs/promises';",
          "import path from 'path';",
          "import { Button } from '@ui/button';",
          "import { cn } from '@/lib/cn';",
          "import { x } from 'utils/date';",
          "import { helper } from './helper';",
          "import { magic } from 'super-magic-sdk';",
          "const z = require('zodd');",
          "export { thing } from '@made-up/thing/sub';",
        ].join('\n'),
      },
    ]);
    expect(
      deps.map(
        ({ name, places }) => `${name} ${places[0]?.source}:${places[0]?.line}`,
      ),
    ).toEqual([
      'react manifest:1',
      'super-magic-sdk import:8',
      'zodd import:9',
      '@made-up/thing import:10',
    ]);
  });

  it("doesn't read imports in a project with no package.json", () => {
    expect(
      findDependencies([
        { path: 'main.ts', text: "import x from 'some-cdn-thing';" },
      ]),
    ).toEqual([]);
  });

  it('says where the name came from in the finding', async () => {
    const { result } = await run(
      { 'README.md': 'npm install react-auth-helpers-pro' },
      {},
    );
    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings[0]?.evidence[0]?.detail).toMatch(
      /^Installed by this command\. npm has no package/,
    );
  });
});

describe('install scripts', () => {
  it('grades a new, barely used package that runs code on install higher', async () => {
    const { result } = await run(
      { 'package.json': '{"dependencies":{"helpful-thing":"1"}}' },
      {
        [npm('helpful-thing')]: {
          status: 200,
          json: {
            'dist-tags': { latest: '1.0.1' },
            time: { created: daysAgo(4) },
            versions: {
              '1.0.1': { scripts: { postinstall: 'node setup.js' } },
            },
          },
        },
      },
    );
    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings).toMatchObject([
      {
        severity: 'high',
        title:
          'helpful-thing is brand new, barely used, and runs code when installed',
        evidence: [
          { detail: expect.stringContaining('runs a script on your computer') },
        ],
      },
    ]);
  });
});

describe('lookalikes', () => {
  it.each([
    ['reqeusts', 'requests', true],
    ['requets', 'requests', true],
    ['requestss', 'requests', true],
    ['requests', 'requests', false],
    ['react-dom', 'react-is', false],
  ])('%s and %s: one typo apart is %s', (a, b, apart) => {
    expect(oneTypoApart(a, b)).toBe(apart);
  });

  it('matches names against popular packages, and leaves popular ones alone', () => {
    expect(lookalikeOf('pypi', 'reqeusts')).toBe('requests');
    expect(lookalikeOf('npm', 'crossenv')).toBe('cross-env');
    expect(lookalikeOf('npm', 'express')).toBeUndefined();
    expect(lookalikeOf('npm', 'my-own-unusual-name')).toBeUndefined();
  });

  it('reports a barely used lookalike, with a fix that names the real one', async () => {
    const { result } = await run(
      { 'requirements.txt': 'reqeusts\n' },
      {
        [pypi('reqeusts')]: {
          status: 200,
          json: {
            releases: { '1.0': [{ upload_time_iso_8601: daysAgo(900) }] },
          },
        },
        'https://pypistats.org/api/packages/reqeusts/recent': {
          status: 200,
          json: { data: { last_week: 12 } },
        },
      },
    );
    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings).toMatchObject([
      {
        severity: 'medium',
        title: 'reqeusts looks like a misspelling of requests',
        manualFix: { snippet: expect.stringContaining('pip install requests') },
      },
    ]);
  });

  it('suggests the real name for a made-up one that is a typo away', async () => {
    const { result } = await run(
      { 'package.json': '{"dependencies":{"expresss":"4"}}' },
      {},
    );
    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings[0]?.evidence[0]?.detail).toContain(
      'Did you mean express?',
    );
  });
});

describe('known malware from OSV', () => {
  const advisory = (affected: unknown) => ({
    status: 200,
    json: { affected: [affected] },
  });
  const batch = (ids: string[][]) => ({
    status: 200,
    json: {
      results: ids.map((list) => ({ vulns: list.map((id) => ({ id })) })),
    },
  });
  const files = {
    'package.json': '{"dependencies":{"evil-helper":"1","chalk":"5"}}',
  };

  it('reports a package OSV lists as malware in every version, not one with a few hijacked versions', async () => {
    const { result } = await run(files, {
      [OSV_BATCH]: batch([['MAL-2026-1', 'GHSA-xxxx'], ['MAL-2025-46969']]),
      'https://api.osv.dev/v1/vulns/MAL-2026-1': advisory({
        ranges: [{ events: [{ introduced: '0' }] }],
      }),
      'https://api.osv.dev/v1/vulns/MAL-2025-46969': advisory({
        versions: ['5.6.1'],
      }),
      [npm('evil-helper')]: OLD_NPM,
      [npm('chalk')]: {
        status: 200,
        json: {
          'dist-tags': { latest: '5.6.2' },
          time: { created: daysAgo(4000) },
          versions: { '5.6.0': {}, '5.6.1': {}, '5.6.2': {} },
        },
      },
    });
    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings).toMatchObject([
      {
        severity: 'critical',
        title: 'evil-helper is known malware',
        lessonId: 'slopsquatting:malware-package',
        safetyStep: expect.stringContaining('stolen'),
        evidence: [{ detail: expect.stringContaining('MAL-2026-1') }],
      },
    ]);
  });

  it.each([
    [
      'a range from 0 that was never fixed',
      { ranges: [{ events: [{ introduced: '0' }] }] },
      ['1.0.0'],
      true,
    ],
    [
      'a range that was fixed',
      { ranges: [{ events: [{ introduced: '0' }, { fixed: '1.0.1' }] }] },
      ['1.0.0'],
      false,
    ],
    [
      'a list of every version',
      { versions: ['1.0.0', '1.0.1'] },
      ['1.0.0', '1.0.1'],
      true,
    ],
    [
      'a list of some versions',
      { versions: ['1.0.1'] },
      ['1.0.0', '1.0.1'],
      false,
    ],
    [
      'a list, for a package the registry removed',
      { versions: ['1.0.1'] },
      [],
      true,
    ],
    [
      'a list, when the registry entry was too big to read',
      { versions: ['1.0.1'] },
      undefined,
      false,
    ],
  ])('%s', (_name, affected, versions, whole) => {
    expect(coversWholePackage({ affected: [affected] }, versions)).toBe(whole);
  });

  it('says so when OSV is down, and still reports what the registries found', async () => {
    const { result } = await run(
      { 'package.json': '{"dependencies":{"react-auth-helpers-pro":"1"}}' },
      { [OSV_BATCH]: 'down' },
    );
    expect(result).toMatchObject({
      status: 'ran',
      findings: [{ severity: 'high' }],
      note: expect.stringContaining("OSV.dev's malware database didn't answer"),
    });
  });

  it('every kind of finding has an explanation', () => {
    for (const kind of ['missing', 'malware', 'new', 'lookalike']) {
      expect(
        LESSONS[`slopsquatting:${kind}-package` as keyof typeof LESSONS],
      ).toBeDefined();
    }
  });
});

describe('imports alone', () => {
  it("don't report a missing package, since it may be a generated file or an alias", async () => {
    const { result } = await run(
      {
        'package.json': '{"dependencies":{"react":"19"}}',
        'utils/admin.ts': "import type { Database } from 'types_db';",
      },
      { [npm('react')]: { status: 200, json: {}, truncated: true } },
    );
    expect(result).toEqual({ status: 'ran', findings: [] });
  });

  it('still report an imported package that exists and looks wrong', async () => {
    const { result } = await run(
      {
        'package.json': '{"dependencies":{}}',
        'src/app.ts': "import thing from 'helpful-thing';",
      },
      {
        [npm('helpful-thing')]: {
          status: 200,
          json: {
            'dist-tags': { latest: '1.0.0' },
            time: { created: daysAgo(2) },
          },
        },
      },
    );
    if (result.status !== 'ran') throw new Error('did not run');
    expect(result.findings).toMatchObject([
      { title: 'helpful-thing is brand new on npm and barely used' },
    ]);
  });
});
