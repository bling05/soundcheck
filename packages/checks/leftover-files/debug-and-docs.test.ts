import { LESSONS } from '@soundcheck/report';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startFixture,
  type FixtureSite,
  type RunningFixture,
} from '../../../fixtures/server';
import { testFetchFor } from '../request-guard/test-fetch';
import { leftoverFiles } from './index';
import { findDebugOutput, readApiDocs } from './rules';

let site: RunningFixture;
afterEach(() => site?.stop());

const home = { body: '<!doctype html><h1>Hi</h1>' };

async function findingsFor(pages: FixtureSite) {
  site = await startFixture(pages);
  const result = await leftoverFiles.run({
    url: site.url,
    fetch: testFetchFor(site),
    platforms: [],
  });
  if (result.status !== 'ran') throw new Error(`did not run: ${result.reason}`);
  return result.findings;
}

const DJANGO_404 =
  "<html><body><p>You're seeing this error because you have <code>DEBUG = True</code> in your Django settings file. Change that to False</p></body></html>";
const PHPINFO =
  '<!DOCTYPE html><html><head><title>PHP 8.2.1 - phpinfo()</title></head><body>PHP Version 8.2.1</body></html>';
const OPENAPI = JSON.stringify({
  openapi: '3.0.1',
  info: { title: 'Shop API' },
  paths: { '/users': {}, '/orders': {}, '/admin/refund': {} },
});

describe('debug pages', () => {
  it("reports a debug error page, even though it's a 404", async () => {
    const findings = await findingsFor({
      '/': home,
      '*': { status: 404, body: DJANGO_404 },
    });

    expect(findings.map(({ id, severity }) => [id, severity])).toEqual([
      ['leftover-files:debug-page', 'high'],
    ]);
    expect(findings[0]?.evidence[0]?.detail).toContain("Django's debug mode");
  });

  it('reports a phpinfo page', async () => {
    const findings = await findingsFor({
      '/': home,
      '/phpinfo.php': { body: PHPINFO },
    });

    expect(findings.map(({ id }) => id)).toEqual(['leftover-files:debug-page']);
  });

  it('reports a live site running a development server', async () => {
    const findings = await findingsFor({
      '/': {
        body: '<html><head><script type="module" src="/@vite/client"></script></head></html>',
      },
    });

    expect(findings[0]?.evidence[0]?.detail).toContain(
      "Vite's development server",
    );
  });
});

describe('API documentation', () => {
  it('reports a public OpenAPI file, counting its addresses', async () => {
    const findings = await findingsFor({
      '/': home,
      '/openapi.json': { body: OPENAPI },
    });

    expect(findings).toMatchObject([
      {
        id: 'leftover-files:api-docs',
        severity: 'low',
        evidence: [
          {
            detail: "This file is public and lists 3 of your API's addresses.",
          },
        ],
      },
    ]);
  });

  it('reports a Swagger page', async () => {
    const findings = await findingsFor({
      '/': home,
      '/docs': {
        body: '<html><link rel="stylesheet" href="https://cdn.example/swagger-ui.css"><script src="https://cdn.example/swagger-ui-bundle.js"></script></html>',
      },
    });

    expect(findings.map(({ id }) => id)).toEqual(['leftover-files:api-docs']);
  });
});

describe('false alarms', () => {
  it('finds nothing on a site that answers every address with its home page', async () => {
    expect(await findingsFor({ '/': home, '*': home })).toEqual([]);
  });

  it('ignores a page that only talks about these things', async () => {
    const text =
      '<html><p>Our docs explain DEBUG = True, Swagger, phpinfo, and openapi: "3.0".</p></html>';

    expect(await findingsFor({ '/': home, '*': { body: text } })).toEqual([]);
  });

  it('has explanations for both new kinds', () => {
    expect(LESSONS['leftover-files:debug-page']).toBeDefined();
    expect(LESSONS['leftover-files:api-docs']).toBeDefined();
  });
});

describe('findDebugOutput and readApiDocs', () => {
  it.each([
    [DJANGO_404, 'django'],
    [PHPINFO, 'phpinfo'],
    ['{"activeProfiles":[],"propertySources":[]}', 'spring-env'],
    ['<script>self.__next_f=1;{"buildId":"development"}</script>', 'next-dev'],
    ['<h1>Debugging tips</h1>', undefined],
  ])('reads %s as %s', (text, kind) => {
    expect(findDebugOutput(text)).toBe(kind);
  });

  it('still recognizes a spec that was cut off at the size limit', () => {
    expect(readApiDocs('{"openapi":"3.1.0","paths":{"/a":')).toEqual({
      kind: 'spec',
    });
  });
});
