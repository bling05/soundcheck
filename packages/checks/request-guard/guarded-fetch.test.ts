import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPublicAddress } from './address-policy';
import {
  DisallowedHeaderError,
  DisallowedRequestError,
  fetchWithPolicy,
  guardedFetch,
  type GuardPolicy,
} from './guarded-fetch';

let server: http.Server;
let port: number;
let requests: http.IncomingMessage[];
let handler: http.RequestListener;

beforeEach(async () => {
  requests = [];
  handler = (_request, response) => response.end('hello');
  server = http.createServer((request, response) => {
    requests.push(request);
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

/** The test server is on loopback, so these tests allow that one address and nothing else. */
function testPolicy(overrides: Partial<GuardPolicy> = {}): GuardPolicy {
  return {
    isAddressAllowed: (address) => address === '127.0.0.1',
    allowedPorts: [port],
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    ...overrides,
  };
}

const realRules = (resolve: GuardPolicy['resolve']): GuardPolicy => ({
  isAddressAllowed: isPublicAddress,
  allowedPorts: [80, 443],
  resolve,
});

describe('guardedFetch refuses a URL without contacting it', () => {
  it.each([
    ['not a url', 'invalid-url'],
    ['file:///etc/passwd', 'blocked-scheme'],
    ['gopher://example.com/', 'blocked-scheme'],
    ['ftp://example.com/', 'blocked-scheme'],
    ['http://user:pass@example.com/', 'blocked-credentials'],
    ['http://example.com:8080/', 'blocked-port'],
    ['https://example.com:22/', 'blocked-port'],
  ])('%s', async (url, reason) => {
    expect(await guardedFetch(url)).toMatchObject({ ok: false, reason });
  });

  it.each([
    ['http://127.0.0.1/'],
    ['http://127.1/'],
    ['http://2130706433/'],
    ['http://0x7f000001/'],
    ['http://0x7f.0.0.1/'],
    ['http://0177.0.0.1/'],
    ['http://127.0.0.1./'],
    ['http://[::1]/'],
    ['http://[::ffff:127.0.0.1]/'],
    ['http://[::ffff:7f00:1]/'],
    ['http://0/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://2852039166/latest/meta-data/'], // 169.254.169.254 as one number
    ['http://[fd00:ec2::254]/'],
    ['http://100.100.100.200/'],
    ['http://168.63.129.16/'],
    ['http://192.168.1.10/admin'],
    ['http://10.0.0.1/'],
    ['http://localhost/'], // Resolved for real, and it always means this machine.
  ])('blocks the disguised or internal address %s', async (url) => {
    expect(await guardedFetch(url)).toMatchObject({
      ok: false,
      reason: 'blocked-address',
    });
  });

  it('never reaches a server listening on localhost', async () => {
    const result = await guardedFetch(`http://127.0.0.1:${port}/`);

    expect(result).toMatchObject({ ok: false, reason: 'blocked-address' });
    expect(requests).toHaveLength(0);
  });

  it('does not reveal internal addresses in its message', async () => {
    const result = await fetchWithPolicy(
      'http://sneaky-site.test/',
      {},
      realRules(async () => [{ address: '10.1.2.3', family: 4 }]),
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('10.1.2.3');
  });
});

describe('DNS answers', () => {
  it('blocks a domain that points at an internal address', async () => {
    const result = await fetchWithPolicy(
      'http://sneaky-site.test/',
      {},
      realRules(async () => [{ address: '169.254.169.254', family: 4 }]),
    );

    expect(result).toMatchObject({ ok: false, reason: 'blocked-address' });
  });

  it('blocks a domain when only one of its answers is internal', async () => {
    const result = await fetchWithPolicy(
      'http://sneaky-site.test/',
      {},
      realRules(async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    );

    expect(result).toMatchObject({ ok: false, reason: 'blocked-address' });
  });

  it('connects to the checked address and never asks DNS again', async () => {
    const answers = ['127.0.0.1', '169.254.169.254'];
    const looked: string[] = [];
    const policy = testPolicy({
      resolve: async (hostname) => {
        looked.push(hostname);
        return [{ address: answers.shift() ?? '169.254.169.254', family: 4 }];
      },
    });

    const result = await fetchWithPolicy(
      `http://rebinder.test:${port}/`,
      {},
      policy,
    );

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(looked).toEqual(['rebinder.test']);
    expect(requests[0]?.headers.host).toBe(`rebinder.test:${port}`);
  });

  it('reports a name that does not resolve as a network error', async () => {
    const result = await fetchWithPolicy(
      `http://missing.test:${port}/`,
      {},
      testPolicy({ resolve: async () => [] }),
    );

    expect(result).toMatchObject({ ok: false, reason: 'network-error' });
  });
});

describe('redirects', () => {
  function redirectTo(location: string) {
    handler = (request, response) => {
      if (request.url === '/final') {
        response.end('arrived');
        return;
      }
      response.writeHead(302, { location });
      response.end();
    };
  }

  it('follows a redirect that passes the checks', async () => {
    redirectTo('/final');

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}/start`,
      {},
      testPolicy(),
    );

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      url: `http://127.0.0.1:${port}/final`,
    });
    if (result.ok) expect(result.body.toString()).toBe('arrived');
  });

  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'blocked-address'],
    ['http://2852039166/', 'blocked-address'], // 169.254.169.254 as one number
    ['file:///etc/passwd', 'blocked-scheme'],
  ])('refuses a redirect to %s', async (location, reason) => {
    redirectTo(location);

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}/start`,
      {},
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: false, reason });
  });

  it('re-checks DNS for a domain it was redirected to', async () => {
    redirectTo(`http://sneaky-site.test:${port}/`);
    const policy = testPolicy({
      resolve: async (hostname) => [
        {
          address: hostname === 'sneaky-site.test' ? '10.0.0.5' : '127.0.0.1',
          family: 4,
        },
      ],
    });

    const result = await fetchWithPolicy(
      `http://start.test:${port}/start`,
      {},
      policy,
    );

    expect(result).toMatchObject({ ok: false, reason: 'blocked-address' });
    expect(requests).toHaveLength(1);
  });

  it('stops after too many redirects', async () => {
    redirectTo('/start');

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}/start`,
      {},
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: false, reason: 'too-many-redirects' });
    expect(requests).toHaveLength(6);
  });
});

describe('responses', () => {
  it('returns an error page as a normal response', async () => {
    handler = (_request, response) => {
      response.writeHead(404, { 'x-frame-options': 'DENY' });
      response.end('missing');
    };

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}/`,
      {},
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: true, status: 404 });
    if (result.ok) expect(result.headers['x-frame-options']).toBe('DENY');
  });

  it('sends GET by default and allows HEAD', async () => {
    await fetchWithPolicy(`http://127.0.0.1:${port}/`, {}, testPolicy());
    await fetchWithPolicy(
      `http://127.0.0.1:${port}/`,
      { method: 'HEAD' },
      testPolicy(),
    );

    expect(requests.map((request) => request.method)).toEqual(['GET', 'HEAD']);
  });

  it('cuts off a body that is over the size limit', async () => {
    handler = (_request, response) => response.end('x'.repeat(1000));

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}/`,
      { maxBytes: 100 },
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.body).toHaveLength(100);
  });

  it('keeps a body that is exactly at the size limit', async () => {
    handler = (_request, response) => response.end('x'.repeat(100));

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}/`,
      { maxBytes: 100 },
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: true, truncated: false });
    if (result.ok) expect(result.body).toHaveLength(100);
  });
});

describe('failures', () => {
  it('times out when a site never answers', async () => {
    handler = () => {};

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}/`,
      { timeoutMs: 50 },
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('times out when a site stalls partway through the body', async () => {
    handler = (_request, response) => {
      response.write('partial');
    };

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}/`,
      { timeoutMs: 50 },
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('reports a dropped connection as a network error, not a short success', async () => {
    handler = (_request, response) => {
      response.write('partial');
      setTimeout(() => response.destroy(), 10);
    };

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}/`,
      {},
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: false, reason: 'network-error' });
  });

  it('reports a refused connection as a network error', async () => {
    const closedPort = port;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${closedPort}/`,
      {},
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: false, reason: 'network-error' });

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
  });
});

describe('extra headers', () => {
  it('sends allowed headers', async () => {
    await fetchWithPolicy(
      `http://127.0.0.1:${port}/`,
      { headers: { apikey: 'public-key', Prefer: 'count=exact' } },
      testPolicy(),
    );

    expect(requests[0]?.headers).toMatchObject({
      apikey: 'public-key',
      prefer: 'count=exact',
    });
  });

  it.each(['accept-encoding', 'host', 'cookie', 'user-agent'])(
    'refuses to send %s, which could undo the guard',
    async (name) => {
      await expect(
        fetchWithPolicy(
          `http://127.0.0.1:${port}/`,
          { headers: { [name]: 'x' } },
          testPolicy(),
        ),
      ).rejects.toThrow(DisallowedHeaderError);
      expect(requests).toHaveLength(0);
    },
  );

  it('keeps them on a redirect within the same host', async () => {
    handler = (request, response) => {
      if (request.url === '/final') return response.end('arrived');
      response.writeHead(302, { location: '/final' });
      response.end();
    };

    await fetchWithPolicy(
      `http://127.0.0.1:${port}/start`,
      { headers: { apikey: 'public-key' } },
      testPolicy(),
    );

    expect(requests.map(({ headers }) => headers.apikey)).toEqual([
      'public-key',
      'public-key',
    ]);
  });

  it('drops them on a redirect to another host, so a key never travels on', async () => {
    handler = (request, response) => {
      if (request.url === '/final') return response.end('arrived');
      response.writeHead(302, {
        location: `http://other-site.test:${port}/final`,
      });
      response.end();
    };

    const result = await fetchWithPolicy(
      `http://first-site.test:${port}/start`,
      { headers: { apikey: 'public-key', authorization: 'Bearer k' } },
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(requests[0]?.headers.apikey).toBe('public-key');
    expect(requests[1]?.headers.apikey).toBeUndefined();
    expect(requests[1]?.headers.authorization).toBeUndefined();
  });
});

describe('read-only POST', () => {
  const LIST = '/storage/v1/object/list/avatars';

  it('sends a small JSON question to a read-only address', async () => {
    let received = '';
    handler = (request, response) => {
      request.on('data', (chunk: Buffer) => (received += chunk.toString()));
      request.on('end', () => response.end('[]'));
    };

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}${LIST}`,
      { method: 'POST', json: { prefix: '', limit: 100 } },
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(received)).toEqual({ prefix: '', limit: 100 });
  });

  it.each([
    '/rest/v1/profiles',
    '/storage/v1/object/avatars/photo.png',
    '/storage/v1/object/list/avatars/../../rest',
    `${LIST}?x=1`,
    '/',
    // Read-only on api.osv.dev only, so it's refused on any other host.
    '/v1/querybatch',
  ])('refuses POST to %s, which could change data', async (path) => {
    await expect(
      fetchWithPolicy(
        `http://127.0.0.1:${port}${path}`,
        { method: 'POST', json: {} },
        testPolicy(),
      ),
    ).rejects.toThrow(DisallowedRequestError);
    expect(requests).toHaveLength(0);
  });

  it('refuses a body on GET', async () => {
    await expect(
      fetchWithPolicy(
        `http://127.0.0.1:${port}/`,
        { json: { a: 1 } },
        testPolicy(),
      ),
    ).rejects.toThrow(DisallowedRequestError);
  });

  it('refuses a big body', async () => {
    await expect(
      fetchWithPolicy(
        `http://127.0.0.1:${port}${LIST}`,
        { method: 'POST', json: { prefix: 'x'.repeat(2000) } },
        testPolicy(),
      ),
    ).rejects.toThrow(DisallowedRequestError);
  });

  it('never sends a POST on to where a redirect points', async () => {
    handler = (_request, response) => {
      response.writeHead(307, { location: '/rest/v1/profiles' });
      response.end();
    };

    const result = await fetchWithPolicy(
      `http://127.0.0.1:${port}${LIST}`,
      { method: 'POST', json: {} },
      testPolicy(),
    );

    expect(result).toMatchObject({ ok: true, status: 307 });
    expect(requests).toHaveLength(1);
  });
});
