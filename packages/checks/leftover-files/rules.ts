export type LeftoverRuleId =
  | 'env-file'
  | 'git-folder'
  | 'database-dump'
  | 'site-archive'
  | 'debug-page'
  | 'api-docs'
  | 'source-map';

export type ProbeRuleId = Exclude<LeftoverRuleId, 'source-map'>;

export interface Probe {
  rule: ProbeRuleId;
  path: string;
}

/** Files that should never be public, at the addresses they usually end up at. */
export const PROBES: readonly Probe[] = [
  { rule: 'env-file', path: '/.env' },
  { rule: 'env-file', path: '/.env.local' },
  { rule: 'env-file', path: '/.env.production' },
  { rule: 'git-folder', path: '/.git/HEAD' },
  { rule: 'database-dump', path: '/backup.sql' },
  { rule: 'database-dump', path: '/dump.sql' },
  { rule: 'database-dump', path: '/database.sql' },
  { rule: 'database-dump', path: '/db.sql' },
  { rule: 'site-archive', path: '/backup.zip' },
  { rule: 'site-archive', path: '/site.zip' },
  { rule: 'debug-page', path: '/phpinfo.php' },
  { rule: 'debug-page', path: '/info.php' },
  { rule: 'debug-page', path: '/actuator/env' },
  // A page that doesn't exist, to see the site's error page. In debug mode, frameworks
  // like Django and Rails show their settings and code there.
  { rule: 'debug-page', path: '/soundcheck-missing-page' },
  { rule: 'api-docs', path: '/swagger.json' },
  { rule: 'api-docs', path: '/openapi.json' },
  { rule: 'api-docs', path: '/api-docs' },
  { rule: 'api-docs', path: '/v3/api-docs' },
  { rule: 'api-docs', path: '/swagger-ui.html' },
  { rule: 'api-docs', path: '/docs' },
  { rule: 'api-docs', path: '/api/docs' },
];

/**
 * Many sites answer every address with their home page, even `/.env`. So a file only
 * counts as found when its contents look like that kind of file, never because it loaded.
 */
function looksLikeHtml(text: string): boolean {
  return /^\s*</.test(text);
}

// Upper case names only. Real .env files almost always use them, and requiring it keeps a
// stray `a=b` in some other file from counting.
const ENV_SETTING = /^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=/;
const MIN_SHARE_OF_SETTINGS = 0.8;

/** How many settings a .env file holds, or 0 if this isn't one. Never returns names or values. */
export function countEnvSettings(text: string): number {
  if (looksLikeHtml(text)) return 0;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const settings = lines.filter((line) => ENV_SETTING.test(line)).length;
  return lines.length > 0 && settings >= lines.length * MIN_SHARE_OF_SETTINGS
    ? settings
    : 0;
}

/** `.git/HEAD` names the current branch, or holds a commit hash when none is checked out. */
export function isGitHead(text: string): boolean {
  return /^(?:ref: refs\/\S+|[0-9a-f]{40})$/.test(text.trim());
}

const SQL_DUMP =
  /PostgreSQL database dump|MySQL dump|\bCREATE TABLE\b|\bINSERT INTO\b/i;

export function isDatabaseDump(text: string): boolean {
  return !looksLikeHtml(text) && SQL_DUMP.test(text);
}

/** Every zip file starts with these 4 bytes. */
export function isZip(body: Buffer): boolean {
  return (
    body.length >= 4 &&
    body[0] === 0x50 &&
    body[1] === 0x4b &&
    body[2] === 0x03 &&
    body[3] === 0x04
  );
}

export type DebugKind =
  | 'phpinfo'
  | 'django'
  | 'laravel'
  | 'rails'
  | 'spring-env'
  | 'vite-dev'
  | 'next-dev';

// Each is something only the framework's own debug output contains, so a page that merely
// mentions debugging doesn't count.
const DEBUG_SIGNS: readonly [DebugKind, RegExp][] = [
  ['phpinfo', /phpinfo\(\)\s*<\/title>/i],
  ['django', /DEBUG = True<\/code> in your Django settings file/],
  ['laravel', /\bwindow\.ignite\b|Whoops\\Run|class="Whoops container"/],
  [
    'rails',
    /Action Controller: Exception caught|<h1>Routing Error<\/h1>[\s\S]{0,4000}Rails\.root/,
  ],
  [
    'spring-env',
    /^\s*\{[\s\S]*"activeProfiles"\s*:[\s\S]*"propertySources"\s*:/,
  ],
  ['vite-dev', /<script[^>]+src=["']\/@vite\/client["']/],
  ['next-dev', /"buildId"\s*:\s*"development"/],
];

/** Which framework's debug output this is, or undefined if it isn't any. */
export function findDebugOutput(text: string): DebugKind | undefined {
  return DEBUG_SIGNS.find(([, sign]) => sign.test(text))?.[0];
}

const API_SPEC = /^\s*\{[\s\S]*"(?:swagger|openapi)"\s*:\s*"[23]\./;
const API_DOCS_PAGE =
  /swagger-ui(?:-bundle)?(?:\.min)?\.js|swagger-ui\.css|SwaggerUIBundle\s*\(|<redoc\b|redoc\.standalone\.js/i;

export type ApiDocs = { kind: 'spec'; addresses?: number } | { kind: 'page' };

/** What kind of API documentation this is, or undefined if it isn't any. */
export function readApiDocs(text: string): ApiDocs | undefined {
  if (API_SPEC.test(text)) {
    try {
      const spec: unknown = JSON.parse(text);
      const paths =
        typeof spec === 'object' && spec !== null && 'paths' in spec
          ? spec.paths
          : undefined;
      return {
        kind: 'spec',
        ...(typeof paths === 'object' &&
          paths !== null && { addresses: Object.keys(paths).length }),
      };
    } catch {
      // Cut off at the size limit, or not quite JSON. It's still the spec.
      return { kind: 'spec' };
    }
  }
  return API_DOCS_PAGE.test(text) ? { kind: 'page' } : undefined;
}

/** Whether a probe found the file, given what came back. */
export function matchesProbe(rule: ProbeRuleId, body: Buffer): boolean {
  const text = body.toString();
  switch (rule) {
    case 'env-file':
      return countEnvSettings(text) > 0;
    case 'git-folder':
      return isGitHead(text);
    case 'database-dump':
      return isDatabaseDump(text);
    case 'site-archive':
      return isZip(body);
    case 'debug-page':
      return findDebugOutput(text) !== undefined;
    case 'api-docs':
      return readApiDocs(text) !== undefined;
  }
}

export type SourceMapContents = 'code' | 'file-names';

/** What a source map gives away, or undefined if this isn't one. */
export function readSourceMap(text: string): SourceMapContents | undefined {
  if (looksLikeHtml(text)) return undefined;
  if (!/"version"\s*:\s*3/.test(text) || !/"sources"\s*:\s*\[/.test(text)) {
    return undefined;
  }
  return /"sourcesContent"\s*:\s*\[\s*"/.test(text) ? 'code' : 'file-names';
}

const SOURCE_MAP_COMMENT = /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/;
const INLINE_MAP = /^data:application\/json[^,]*;base64,(.+)$/;

export type SourceMapReference =
  | { kind: 'inline'; contents: SourceMapContents | undefined }
  | { kind: 'linked'; url: string };

/** Where a code file says its source map is, from the comment build tools add at the end. */
export function findSourceMap(
  code: string,
  fileUrl: string,
): SourceMapReference | undefined {
  const reference = SOURCE_MAP_COMMENT.exec(code.trimEnd())?.[1];
  if (!reference) return undefined;
  const inline = INLINE_MAP.exec(reference)?.[1];
  if (inline) {
    return {
      kind: 'inline',
      contents: readSourceMap(Buffer.from(inline, 'base64').toString()),
    };
  }
  try {
    return { kind: 'linked', url: new URL(reference, fileUrl).href };
  } catch {
    return undefined;
  }
}
