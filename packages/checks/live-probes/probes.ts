import type { GuardedFetch, GuardedFetchResult } from '../request-guard';
import { withParam, type Target } from './targets';

export type ProbeKind =
  'reflected-xss' | 'sql-error' | 'path-traversal' | 'open-api' | 'open-signup';

export interface ProbeFinding {
  kind: ProbeKind;
  /** Where it was seen, without the test value, so the report never repeats the payload. */
  url: string;
  param?: string;
  detail: string;
}

const TIMEOUT_MS = 8_000;
// Bodies bigger than this are cut off. Errors and reflections show up near the top.
const MAX_BYTES = 512 * 1024;

type Ok = Extract<GuardedFetchResult, { ok: true }>;

async function get(
  fetch: GuardedFetch,
  url: string,
  headers?: Record<string, string>,
): Promise<Ok | undefined> {
  const response = await fetch(url, {
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    ...(headers && { headers }),
  });
  return response.ok ? response : undefined;
}

function contentType(response: Ok): string {
  const header = response.headers['content-type'];
  return (Array.isArray(header) ? header[0] : header) ?? '';
}

// 1. Reflected XSS: a harmless made-up tag that a browser would treat as real HTML if the
// page puts it back unescaped. It runs nothing. A safe page shows it as `&lt;scx…&gt;`.

/** A fresh marker per scan, so a cached or unrelated page can't match by chance. */
export function xssMarker(): string {
  return `scx${Math.random().toString(36).slice(2, 8)}`;
}

export async function probeXss(
  target: Target,
  param: string,
  fetch: GuardedFetch,
  marker = xssMarker(),
): Promise<ProbeFinding | undefined> {
  const response = await get(fetch, withParam(target, param, `"'><${marker}>`));
  if (!response || !/html/i.test(contentType(response))) return undefined;
  if (!response.body.toString().includes(`<${marker}>`)) return undefined;
  return {
    kind: 'reflected-xss',
    url: target.url,
    param,
    detail: `We put a harmless made-up HTML tag in the ${param} parameter, and the page included it as real HTML instead of plain text.`,
  };
}

// 2. SQL error text: a lone quote breaks a database query that was built by pasting text
// in. Only counted when the quote causes an error the normal value doesn't.

const DATABASE_ERROR =
  /You have an error in your SQL syntax|mysqli?_(?:fetch|query|num_rows)|SQLSTATE\[|PG::SyntaxError|unterminated quoted string at or near|syntax error at or near|pg_query\(\)|SQLite3::|sqlite3\.OperationalError|unrecognized token:|ORA-0\d{4}|Unclosed quotation mark after the character string|quoted string not properly terminated|SequelizeDatabaseError|QueryFailedError|PrismaClientKnownRequestError/i;

export async function probeSqlError(
  target: Target,
  param: string,
  fetch: GuardedFetch,
): Promise<ProbeFinding | undefined> {
  const normal = await get(fetch, withParam(target, param, '1'));
  if (!normal || DATABASE_ERROR.test(normal.body.toString())) return undefined;
  for (const value of ["1'", '1"']) {
    const broken = await get(fetch, withParam(target, param, value));
    const error = broken && DATABASE_ERROR.exec(broken.body.toString())?.[0];
    if (!error) continue;
    return {
      kind: 'sql-error',
      url: target.url,
      param,
      detail: `Adding a quote mark to the ${param} parameter made the page show a database error ("${error}"). That usually means the text goes into a database query unprotected.`,
    };
  }
  return undefined;
}

// 3. Path traversal: asking a file-like parameter for a file outside the site. Only the
// fact that a system file came back is reported, never what's in it.

const FILE_PARAM =
  /^(?:file|filename|filepath|path|page|template|doc|document|download|include|inc|img|image|folder|dir|view|load|read|attachment)$/i;
const TRAVERSALS = [
  '../../../../../../../../etc/passwd',
  '....//....//....//....//....//etc/passwd',
  '..\\..\\..\\..\\..\\..\\windows\\win.ini',
];
const SYSTEM_FILE =
  /root:[x*]?:0:0:|\[fonts\][\s\S]{0,200}\[extensions\]|for 16-bit app support/i;

export function isFileParam(param: string): boolean {
  return FILE_PARAM.test(param);
}

export async function probeTraversal(
  target: Target,
  param: string,
  fetch: GuardedFetch,
): Promise<ProbeFinding | undefined> {
  const normal = await get(fetch, withParam(target, param, 'index'));
  if (normal && SYSTEM_FILE.test(normal.body.toString())) return undefined;
  for (const value of TRAVERSALS) {
    const response = await get(fetch, withParam(target, param, value));
    if (!response || !SYSTEM_FILE.test(response.body.toString())) continue;
    return {
      kind: 'path-traversal',
      url: target.url,
      param,
      detail: `Asking the ${param} parameter for a file outside the site with "../" returned one of the server's own system files. We didn't keep or show its contents.`,
    };
  }
  return undefined;
}

// 4. Open API routes: common addresses that list people, asked without signing in. Only
// the number of records and the kinds of fields are reported, never the data.

export const API_PATHS = [
  '/api/users',
  '/api/user',
  '/api/admin/users',
  '/api/users/all',
  '/api/v1/users',
  '/api/customers',
  '/api/accounts',
  '/api/profiles',
  '/api/members',
];
const PERSONAL_FIELD =
  /e-?mail|phone|password|address|birth|ssn|social_security|passport/i;
const LIST_KEYS = [
  'data',
  'users',
  'items',
  'results',
  'customers',
  'rows',
  'records',
  'members',
  'profiles',
  'accounts',
];

/** The records in a JSON answer: the array itself, or one under a common key like `data`. */
export function recordsIn(json: unknown): Record<string, unknown>[] {
  const list = Array.isArray(json)
    ? json
    : typeof json === 'object' && json !== null
      ? LIST_KEYS.map((key) => (json as Record<string, unknown>)[key]).find(
          Array.isArray,
        )
      : undefined;
  return (list ?? []).filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

export async function probeApi(
  origin: string,
  path: string,
  fetch: GuardedFetch,
): Promise<ProbeFinding | undefined> {
  const response = await get(fetch, `${origin}${path}`);
  if (
    !response ||
    response.status !== 200 ||
    !/json/i.test(contentType(response))
  )
    return undefined;
  let json: unknown;
  try {
    json = JSON.parse(response.body.toString());
  } catch {
    return undefined;
  }
  const records = recordsIn(json);
  const fields = [
    ...new Set(
      records.flatMap((record) =>
        Object.keys(record).filter((key) => PERSONAL_FIELD.test(key)),
      ),
    ),
  ];
  if (records.length === 0 || fields.length === 0) return undefined;
  const shown = fields.slice(0, 5).join(', ');
  return {
    kind: 'open-api',
    url: `${origin}${path}`,
    detail: `Without signing in, this address returned ${records.length === 1 ? '1 record' : `${records.length} records`}${response.truncated ? " (and more we didn't read)" : ''} with fields like ${shown}. We kept only the count and the field names.`,
  };
}

// 5. Open sign-up: Supabase publishes its sign-up settings to the site's own public key.

export async function probeSignup(
  project: { url: string; key: string; isToken: boolean },
  fetch: GuardedFetch,
): Promise<ProbeFinding | undefined> {
  const response = await get(fetch, `${project.url}/auth/v1/settings`, {
    apikey: project.key,
    ...(project.isToken && { authorization: `Bearer ${project.key}` }),
  });
  if (!response || response.status !== 200) return undefined;
  let settings: { disable_signup?: unknown; mailer_autoconfirm?: unknown };
  try {
    settings = JSON.parse(response.body.toString()) as typeof settings;
  } catch {
    return undefined;
  }
  if (settings.disable_signup !== false || settings.mailer_autoconfirm !== true)
    return undefined;
  return {
    kind: 'open-signup',
    url: `${project.url}/auth/v1/settings`,
    detail:
      'Your Supabase settings let anyone create an account, and accounts work right away without confirming an email address.',
  };
}
