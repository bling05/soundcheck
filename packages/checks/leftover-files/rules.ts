export type LeftoverRuleId =
  'env-file' | 'git-folder' | 'database-dump' | 'site-archive' | 'source-map';

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
