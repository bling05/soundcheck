import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

/**
 * A fake website: each path maps to the response it should send. Other paths get the `*`
 * response if there is one, like sites that answer every address with their home page,
 * and a 404 otherwise.
 */
export type FixtureSite = Record<string, FixtureResponse>;

export interface RunningFixture {
  url: string;
  port: number;
  stop(): Promise<void>;
}

/** Starts a fake site on this machine, on a free port. Call `stop` when the test ends. */
export async function startFixture(site: FixtureSite): Promise<RunningFixture> {
  const server = http.createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    const page = site[path] ?? site['*'] ?? { status: 404, body: 'Not found' };

    response.writeHead(page.status ?? 200, page.headers);
    response.end(page.body ?? '');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    stop: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
