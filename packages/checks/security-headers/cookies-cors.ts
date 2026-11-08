type Headers = Record<string, string | string[] | undefined>;

/**
 * Sent as the website a request comes from, to see whether the site lets any website read
 * its responses. `.example` is reserved, so it can never be a real site.
 */
export const TEST_ORIGIN = 'https://soundcheck-cors-check.example';

export type CookieCorsRuleId =
  'cors-any-site' | 'cookie-not-secure' | 'cookie-not-httponly';

export interface CookieCorsProblem {
  rule: CookieCorsRuleId;
  header: string;
  /** Fixed wording plus cookie names at most, never a cookie's value. */
  detail: string;
}

function first(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Plain `*` isn't reported: browsers never send logins with it, so it can only expose what
 * anyone could see anyway. The danger is echoing back any website while allowing logins,
 * which lets a stranger's page read a visitor's private data from this site.
 */
export function checkCors(
  headersForTestOrigin: Headers,
): CookieCorsProblem | null {
  const allowed = first(
    headersForTestOrigin,
    'access-control-allow-origin',
  )?.trim();
  const withLogins =
    first(headersForTestOrigin, 'access-control-allow-credentials')
      ?.trim()
      .toLowerCase() === 'true';
  if (!withLogins || (allowed !== TEST_ORIGIN && allowed !== 'null')) {
    return null;
  }
  return {
    rule: 'cors-any-site',
    header: 'access-control-allow-origin',
    detail:
      'We asked as a made-up website, and your site said that website may read its responses, including for logged-in visitors.',
  };
}

export interface Cookie {
  name: string;
  secure: boolean;
  httpOnly: boolean;
}

/** Reads the flags of each cookie the site sets. Values are dropped right away. */
export function parseCookies(headers: Headers): Cookie[] {
  const raw = headers['set-cookie'];
  const lines = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return lines.flatMap((line) => {
    const [pair = '', ...attributes] = line.split(';');
    const name = pair.split('=')[0]?.trim();
    if (!name) return [];
    const flags = attributes.map((part) =>
      part.trim().split('=')[0]?.trim().toLowerCase(),
    );
    return [
      {
        name,
        secure: flags.includes('secure'),
        httpOnly: flags.includes('httponly'),
      },
    ];
  });
}

// Names that usually mean a login. CSRF tokens are left out: page scripts are meant to
// read those, so they can't be HttpOnly.
const LOGIN_COOKIE = /sess|sid\b|auth|token|login|jwt|remember/i;
const CSRF_COOKIE = /csrf|xsrf/i;

export function isLoginCookie(name: string): boolean {
  return LOGIN_COOKIE.test(name) && !CSRF_COOKIE.test(name);
}

const MAX_NAMES = 5;
const names = (cookies: readonly Cookie[]) =>
  cookies
    .slice(0, MAX_NAMES)
    .map(({ name }) => name)
    .join(', ');

/** Cookie problems, in a fixed order. Only HTTPS pages are judged on Secure. */
export function checkCookies(
  headers: Headers,
  isHttps: boolean,
): CookieCorsProblem[] {
  const cookies = parseCookies(headers);
  const problems: CookieCorsProblem[] = [];

  const notSecure = cookies.filter(
    (cookie) => !cookie.secure && isLoginCookie(cookie.name),
  );
  if (isHttps && notSecure.length > 0) {
    problems.push({
      rule: 'cookie-not-secure',
      header: 'set-cookie',
      detail: `These cookies can also be sent over unencrypted connections: ${names(notSecure)}.`,
    });
  }

  const readable = cookies.filter(
    (cookie) => !cookie.httpOnly && isLoginCookie(cookie.name),
  );
  if (readable.length > 0) {
    problems.push({
      rule: 'cookie-not-httponly',
      header: 'set-cookie',
      detail: `Scripts on the page can read these cookies: ${names(readable)}.`,
    });
  }
  return problems;
}
