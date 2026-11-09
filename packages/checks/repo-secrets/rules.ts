import { redactSecret } from '@soundcheck/shared';
import { matchSecrets, type SecretRuleId } from '../bundle-secrets/rules';
import type { RepoFile } from '../repo';

/**
 * The same keys Check #2 looks for, plus database passwords. Google keys are left out:
 * Firebase config with one is meant to be committed, and Check #2 covers them on the site.
 */
export type CommittedSecretRule =
  Exclude<SecretRuleId, 'google-api-key'> | 'database-url';

export interface Place {
  path: string;
  line: number;
}

export interface CommittedSecret {
  rule: CommittedSecretRule;
  /** Last 4 characters only. The full key never leaves this file. */
  redacted: string;
  /** Every place the same key was found, in the order the files were read. */
  places: Place[];
}

export interface CommittedEnvFile {
  path: string;
  line: number;
  /** Names of the settings that look secret. Never their values. */
  names: string[];
}

const PLACEHOLDER =
  /example|your|placeholder|dummy|sample|fake|xxxx|changeme|change_me|replace|redacted|<|>|\$\{|\{\{|^\[.*\]$|^\*+$/i;

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let at = text.indexOf('\n'); at !== -1 && at < index;) {
    line++;
    at = text.indexOf('\n', at + 1);
  }
  return line;
}

// `postgres://user:password@host/db`, and the same shape for MySQL, MongoDB, and Redis.
const DATABASE_URL =
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?):\/\/[^:/\s'"`@]+:([^@\s'"`]+)@([^\s'"`/:?,]+)/g;
// Databases on the developer's own computer, or in a local Docker setup, aren't reachable
// by anyone else, so their passwords aren't secrets.
const LOCAL_HOST =
  /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal|db|database|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis)$/i;
// Names reserved for testing and local networks, which can never be a real server online.
const RESERVED_HOST = /\.(?:test|example|invalid|localhost|local)$/i;
const DEFAULT_PASSWORDS = /^(?:password|postgres|root|admin|secret|pass)$/i;
const MIN_PASSWORD_LENGTH = 8;

function databasePasswords(text: string): { secret: string; index: number }[] {
  const found: { secret: string; index: number }[] = [];
  for (const match of text.matchAll(DATABASE_URL)) {
    const password = match[1] ?? '';
    const host = match[2] ?? '';
    if (
      password.length < MIN_PASSWORD_LENGTH ||
      DEFAULT_PASSWORDS.test(password) ||
      PLACEHOLDER.test(password) ||
      PLACEHOLDER.test(host) ||
      LOCAL_HOST.test(host) ||
      RESERVED_HOST.test(host)
    )
      continue;
    found.push({ secret: password, index: match.index });
  }
  return found;
}

/** Real keys and database passwords written in the repo. Each distinct one is one secret. */
export function findCommittedSecrets(
  files: readonly RepoFile[],
): CommittedSecret[] {
  const bySecret = new Map<string, CommittedSecret>();
  for (const { path, text } of files) {
    const matches: {
      rule: CommittedSecretRule;
      secret: string;
      index: number;
    }[] = [
      ...matchSecrets(text).flatMap(({ rule, ...match }) =>
        rule === 'google-api-key' ? [] : [{ ...match, rule }],
      ),
      ...databasePasswords(text).map((match) => ({
        ...match,
        rule: 'database-url' as const,
      })),
    ];
    for (const { rule, secret, index } of matches) {
      const place = { path, line: lineOf(text, index) };
      const key = `${rule}:${secret}`;
      const known = bySecret.get(key);
      if (known) known.places.push(place);
      else
        bySecret.set(key, {
          rule,
          redacted: redactSecret(secret),
          places: [place],
        });
    }
  }
  return [...bySecret.values()];
}

// `.env`, `.env.local`, `server/.env.production`. Not `.env.example` and the like, which
// are meant to be committed with made-up values.
const ENV_FILE = /(?:^|\/)\.env(?:\.[\w.-]+)?$/;
const EXAMPLE_ENV_FILE =
  /\.(?:example|sample|template|tmpl|tpl|dist|defaults?|schema|test)$/i;
const SETTING = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const SECRET_NAME =
  /SECRET|PASSWORD|PASSWD|PRIVATE|TOKEN|API_?KEY|ACCESS_KEY|SERVICE_ROLE|DATABASE_URL|_DSN$|CONNECTION_STRING|_URI$/i;
// Settings with these prefixes are copied into the site's public code on purpose.
const PUBLIC_SETTING =
  /^(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|PUBLIC|NUXT_PUBLIC|GATSBY)_/;
const MIN_VALUE_LENGTH = 8;
// A database URL pointing at the developer's own computer.
const LOCAL_DATABASE =
  /^\w+(?:\+srv)?:\/\/(?:[^@\s]*@)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)\b/i;

export function isEnvFile(path: string): boolean {
  return ENV_FILE.test(path) && !EXAMPLE_ENV_FILE.test(path);
}

function settingValue(raw: string): string {
  const value = raw.trim();
  const quoted = /^(["'`])(.*)\1/.exec(value);
  return quoted ? (quoted[2] ?? '') : (value.split(/\s+#/)[0] ?? '').trim();
}

/** Committed `.env` files that set something secret, with the names of those settings. */
export function findEnvFiles(files: readonly RepoFile[]): CommittedEnvFile[] {
  const found: CommittedEnvFile[] = [];
  for (const { path, text } of files) {
    if (!isEnvFile(path)) continue;
    const names: string[] = [];
    let line = 0;
    for (const [index, row] of text.split('\n').entries()) {
      const setting = SETTING.exec(row);
      const name = setting?.[1] ?? '';
      const value = settingValue(setting?.[2] ?? '');
      if (
        !SECRET_NAME.test(name) ||
        PUBLIC_SETTING.test(name) ||
        value.length < MIN_VALUE_LENGTH ||
        PLACEHOLDER.test(value) ||
        LOCAL_DATABASE.test(value)
      )
        continue;
      if (names.length === 0) line = index + 1;
      names.push(name);
    }
    if (names.length > 0) found.push({ path, line, names });
  }
  return found;
}

// Signs the project keeps settings in environment variables, so a `.env` file is likely.
const USES_ENV =
  /\bprocess\.env\b|\bimport\.meta\.env\b|\bdotenv\b|\bos\.environ\b|\bos\.getenv\b|\bDeno\.env\b|\bBun\.env\b/;

export type IgnoreGap =
  { kind: 'no-gitignore' } | { kind: 'not-ignored'; path: string };

/**
 * Whether `.env` files would be committed by accident: the project uses environment
 * variables, but its root `.gitignore` never mentions `.env`. Any mention counts, since
 * some setups mean to commit `.env` and ignore only `.env.local`.
 */
export function findIgnoreGap(
  files: readonly RepoFile[],
): IgnoreGap | undefined {
  const usesEnv = files.some(
    ({ path, text }) =>
      ENV_FILE.test(path) ||
      (/\.(?:[cm]?[jt]sx?|py)$/.test(path) && USES_ENV.test(text)),
  );
  if (!usesEnv) return undefined;
  const gitignore = files.find(({ path }) => path === '.gitignore');
  if (!gitignore) return { kind: 'no-gitignore' };
  const mentionsEnv = gitignore.text
    .split('\n')
    .map((row) => row.trim())
    .some(
      (row) =>
        !row.startsWith('#') && !row.startsWith('!') && row.includes('.env'),
    );
  return mentionsEnv
    ? undefined
    : { kind: 'not-ignored', path: gitignore.path };
}
