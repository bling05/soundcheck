import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { isPublicAddress } from './address-policy';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface GuardedFetchOptions {
  /**
   * Only requests that read. POST is allowed only for addresses in `READ_ONLY_POSTS`,
   * which are search endpoints that use POST to receive their question, never to change
   * anything. A check can't write to a scanned app.
   */
  method?: 'GET' | 'HEAD' | 'POST';
  /** The question for a read-only POST, sent as JSON. Only allowed with POST. */
  json?: unknown;
  /** Limit for the whole request, including every redirect. */
  timeoutMs?: number;
  /** Bodies are cut off at this size and marked `truncated`. */
  maxBytes?: number;
  /**
   * Extra request headers, from a fixed list (see `ALLOWED_HEADERS`). They're dropped if a
   * redirect leads to another host, so a key sent to one site never reaches another.
   */
  headers?: Readonly<Record<string, string>>;
}

/**
 * The only headers a check may add. Nothing here can turn off the guard's own protections,
 * like the request for uncompressed responses.
 */
const ALLOWED_HEADERS = new Set([
  'apikey',
  'authorization',
  'prefer',
  'range',
  // Says which website a request comes from, to see whether the site lets others read it.
  'origin',
]);

/** Thrown for a header outside `ALLOWED_HEADERS`. A bug in a check, never a site's fault. */
export class DisallowedHeaderError extends Error {
  override name = 'DisallowedHeaderError';
}

/**
 * The only addresses a POST may go to. Each one only reads: Supabase's file list takes a
 * folder and a page size and returns names, and OSV.dev's batch lookup takes package
 * names and returns advisory ids. Neither can change or delete anything.
 */
interface ReadOnlyPost {
  /** Only on this host, for an address that's only read-only on one service. */
  host?: string;
  path: RegExp;
  /** A read-only question is small. Anything bigger is a mistake in a check. */
  maxJsonBytes: number;
}

const READ_ONLY_POSTS: readonly ReadOnlyPost[] = [
  {
    path: /^\/storage\/v1\/object\/list\/[A-Za-z0-9_.-]+$/,
    maxJsonBytes: 1024,
  },
  // Google's open vulnerability database. A few hundred package names need more room.
  {
    host: 'api.osv.dev',
    path: /^\/v1\/querybatch$/,
    maxJsonBytes: 64 * 1024,
  },
];

/** Thrown for a POST that isn't a known read-only request. A bug in a check. */
export class DisallowedRequestError extends Error {
  override name = 'DisallowedRequestError';
}

export type GuardFailureReason =
  | 'invalid-url'
  | 'blocked-scheme'
  | 'blocked-credentials'
  | 'blocked-address'
  | 'blocked-port'
  | 'too-many-redirects'
  | 'timeout'
  | 'network-error';

export type GuardedFetchResult =
  | {
      /** The site answered. A 404 or 500 still counts, so check `status`. */
      ok: true;
      status: number;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
      /** The URL that answered, after redirects. */
      url: string;
      truncated: boolean;
    }
  | {
      /** Nothing usable came back. A check should report this as skipped, never as a pass. */
      ok: false;
      reason: GuardFailureReason;
      message: string;
    };

/** A function that visits a link with the guard's protection. Checks receive one in their context. */
export type GuardedFetch = (
  target: string,
  options?: GuardedFetchOptions,
) => Promise<GuardedFetchResult>;

/** What the guard allows. Only `guardedFetch` is public, so callers can't loosen it. */
export interface GuardPolicy {
  isAddressAllowed(address: string): boolean;
  allowedPorts: readonly number[];
  resolve(hostname: string): Promise<{ address: string; family: number }[]>;
}

const DEFAULT_POLICY: GuardPolicy = {
  isAddressAllowed: isPublicAddress,
  allowedPorts: [80, 443],
  resolve: (hostname) => dnsLookup(hostname, { all: true }),
};

// These messages can reach reports. They never say which IP a name resolved to,
// because that would let someone map our internal network through error text.
const FAILURE_MESSAGES: Record<GuardFailureReason, string> = {
  'invalid-url': 'This link is not a valid URL.',
  'blocked-scheme': 'Only http and https links can be scanned.',
  'blocked-credentials':
    'Links with a username or password in them cannot be scanned.',
  'blocked-address':
    'This link points to a private or internal address, so we did not contact it.',
  'blocked-port': 'Only ports 80 and 443 can be scanned.',
  'too-many-redirects': `This link redirected more than ${MAX_REDIRECTS} times, so we stopped following it.`,
  timeout: 'The site took too long to respond.',
  'network-error': 'We could not connect to this site.',
};

function failure(reason: GuardFailureReason): GuardedFetchResult {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

class BlockedAddressError extends Error {}

function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/** Checks everything that can be judged from the URL alone, before any network traffic. */
function checkUrl(url: URL, policy: GuardPolicy): GuardFailureReason | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return 'blocked-scheme';
  if (url.username || url.password) return 'blocked-credentials';

  // Node skips the lookup step for a literal IP, so it has to be judged here. The
  // URL parser has already turned forms like 2130706433 and 0x7f.1 into 127.0.0.1.
  const hostname = bareHostname(url);
  if (isIP(hostname) && !policy.isAddressAllowed(hostname))
    return 'blocked-address';

  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80;
  if (!policy.allowedPorts.includes(port)) return 'blocked-port';

  return null;
}

/**
 * Replaces DNS for one connection. Node connects to the addresses this hands back
 * and never looks the name up again, so a rebinding answer can't slip in after the check.
 */
function guardedLookup(policy: GuardPolicy): LookupFunction {
  return (hostname, options, callback) => {
    policy
      .resolve(hostname)
      .then((addresses) => {
        const [first] = addresses;
        if (!first) throw new Error('No addresses found');
        if (
          !addresses.every(({ address }) => policy.isAddressAllowed(address))
        ) {
          throw new BlockedAddressError();
        }
        return { addresses, first };
      })
      .then(
        ({ addresses, first }) => {
          if (options.all) callback(null, addresses);
          else callback(null, first.address, first.family);
        },
        (error: NodeJS.ErrnoException) => callback(error, ''),
      );
  };
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
}

function sendRequest(
  url: URL,
  method: 'GET' | 'HEAD' | 'POST',
  maxBytes: number,
  signal: AbortSignal,
  policy: GuardPolicy,
  extraHeaders: Readonly<Record<string, string>>,
  body?: Buffer,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: bareHostname(url),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        // Without this, a reused connection would skip the lookup check on the next hop.
        agent: false,
        lookup: guardedLookup(policy),
        signal,
        headers: {
          ...extraHeaders,
          ...(body && {
            'content-type': 'application/json',
            'content-length': String(body.length),
          }),
          accept: '*/*',
          // Asking for no compression means a small response can't expand into a huge one.
          'accept-encoding': 'identity',
          'user-agent': 'SoundcheckScanner',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers = response.headers;

        if (REDIRECT_STATUSES.has(status) && headers.location) {
          response.destroy();
          resolve({ status, headers, body: Buffer.alloc(0), truncated: false });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          const room = maxBytes - size;
          chunks.push(chunk.subarray(0, room));
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            resolve({
              status,
              headers,
              body: Buffer.concat(chunks),
              truncated: true,
            });
          }
        });
        response.on('end', () => {
          resolve({
            status,
            headers,
            body: Buffer.concat(chunks),
            truncated: false,
          });
        });
        response.on('error', reject);
        response.on('close', () => {
          if (!response.complete) reject(new Error('Connection closed early'));
        });
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

/** Runs the guarded request under a given policy. Use `guardedFetch` outside of tests. */
export async function fetchWithPolicy(
  target: string,
  options: GuardedFetchOptions,
  policy: GuardPolicy,
): Promise<GuardedFetchResult> {
  const method = options.method ?? 'GET';
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const extraHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    const key = name.toLowerCase();
    if (!ALLOWED_HEADERS.has(key)) {
      throw new DisallowedHeaderError(`Header not allowed: ${name}`);
    }
    extraHeaders[key] = value;
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return failure('invalid-url');
  }
  const firstHost = url.host;

  if (options.json !== undefined && method !== 'POST') {
    throw new DisallowedRequestError('A body can only be sent with POST');
  }
  let body: Buffer | undefined;
  if (method === 'POST') {
    const allowed = READ_ONLY_POSTS.find(
      ({ host, path }) =>
        (host === undefined || url.hostname === host) &&
        path.test(url.pathname),
    );
    if (!allowed || url.search) {
      throw new DisallowedRequestError(
        `POST is only allowed to read-only addresses, not ${url.pathname}`,
      );
    }
    body = Buffer.from(JSON.stringify(options.json ?? {}));
    if (body.length > allowed.maxJsonBytes) {
      throw new DisallowedRequestError('The request body is too big');
    }
  }

  // Redirects are followed by hand so every hop goes through the same checks as the first.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refused = checkUrl(url, policy);
    if (refused) return failure(refused);

    let response: RawResponse;
    try {
      const headers = url.host === firstHost ? extraHeaders : {};
      response = await sendRequest(
        url,
        method,
        maxBytes,
        signal,
        policy,
        headers,
        body,
      );
    } catch (error) {
      if (error instanceof BlockedAddressError)
        return failure('blocked-address');
      return failure(signal.aborted ? 'timeout' : 'network-error');
    }

    const { location } = response.headers;
    // A POST is never sent on to a new address: the redirect comes back as the answer.
    if (
      !REDIRECT_STATUSES.has(response.status) ||
      !location ||
      method === 'POST'
    ) {
      return { ok: true, ...response, url: url.href };
    }

    try {
      url = new URL(location, url);
    } catch {
      return failure('invalid-url');
    }
  }

  return failure('too-many-redirects');
}

/**
 * The only way a check should make an outbound request. Refuses anything that isn't
 * an ordinary public address, including after DNS and after every redirect.
 */
export function guardedFetch(
  target: string,
  options: GuardedFetchOptions = {},
): Promise<GuardedFetchResult> {
  return fetchWithPolicy(target, options, DEFAULT_POLICY);
}
