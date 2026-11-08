import { stringAssignedBefore, VARIABLE } from '../code-names';
import type { SiteFile } from '../site-files';

export interface SupabaseProject {
  /** Like `https://abcdefghijklmnopqrst.supabase.co`, with no trailing slash. */
  url: string;
  /** The public key the site's own code uses. Never a secret key: those are refused. */
  key: string;
  /** Old-style keys are tokens and also go in the Authorization header. New ones don't. */
  isToken: boolean;
}

// The address setting the app was built with, like `VITE_SUPABASE_URL: "https://..."`. It
// comes first because it's the address the app really uses, which may not be on supabase.co:
// Lovable Cloud, for one, puts Supabase behind its own `*.lovable.cloud` address.
const URL_SETTING =
  /\b(?:[A-Z]+_)*SUPABASE_URL["'`]?\s*[:=]\s*["'`](https:\/\/[^"'`\s]+)["'`]/;
const PROJECT_URL = /https:\/\/[a-z0-9]{20}\.supabase\.(?:co|in)\b/;
// The first argument to createClient, for projects on a custom domain.
const CREATE_CLIENT_URL =
  /createClient\)?\(\s*["'`](https?:\/\/[^"'`\s]+)["'`]/;
const TOKEN = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const PUBLISHABLE_KEY = /\bsb_publishable_[A-Za-z0-9_-]{20,}/;

/** The role inside a Supabase key, like `anon` or `service_role`. */
function tokenRole(token: string): string | undefined {
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    );
    return typeof claims === 'object' && claims !== null && 'role' in claims
      ? String(claims.role)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Finds the Supabase project and public key in the site's code, if it uses Supabase. */
export function findSupabaseProject(
  files: readonly SiteFile[],
): SupabaseProject | undefined {
  let url: string | undefined;
  let key: string | undefined;
  let isToken = false;

  for (const { text } of files) {
    url ??= (
      URL_SETTING.exec(text)?.[1] ??
      PROJECT_URL.exec(text)?.[0] ??
      CREATE_CLIENT_URL.exec(text)?.[1]
    )?.replace(/\/+$/, '');
    if (!key) {
      const publishable = PUBLISHABLE_KEY.exec(text)?.[0];
      const anon = [...text.matchAll(TOKEN)]
        .map(([token]) => token)
        .find((token) => tokenRole(token) === 'anon');
      key = anon ?? publishable;
      isToken = key === anon && anon !== undefined;
    }
    if (url && key) return { url, key, isToken };
  }
  return undefined;
}

// `.from('profiles')`, but not `storage.from('avatars')`, which names a file bucket.
const FROM_CALL = /\.from\(\s*["'`]([A-Za-z_][A-Za-z0-9_]{0,62})["'`]\s*\)/g;
// The match starts at the dot, so what comes right before it is the word `storage`.
const STORAGE_BEFORE = /\bstorage\s*$/;
/** Only read what fits in a scan: a big app might name hundreds of tables. */
export const MAX_TABLES = 25;

// The same call after a build tool moved the name into a variable: `.from(T).select(`.
// The database action after it matters: `Array.from(x)` is everywhere and isn't a table.
const FROM_VARIABLE_CALL = new RegExp(
  `\\.from\\(\\s*(${VARIABLE})\\s*\\)\\s*\\.(?:select|insert|update|upsert|delete)\\(`,
  'g',
);
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** The table names the site's code reads from, in the order first seen. */
export function findTableNames(files: readonly SiteFile[]): string[] {
  const tables = new Set<string>();
  for (const { text } of files) {
    const calls = [
      ...[...text.matchAll(FROM_CALL)].map((match) => ({
        index: match.index,
        name: match[1],
      })),
      ...[...text.matchAll(FROM_VARIABLE_CALL)].map((match) => ({
        index: match.index,
        name: match[1] && stringAssignedBefore(text, match[1], match.index),
      })),
    ].sort((a, b) => a.index - b.index);
    for (const { index, name } of calls) {
      const before = text.slice(Math.max(0, index - 20), index);
      if (name && TABLE_NAME.test(name) && !STORAGE_BEFORE.test(before)) {
        tables.add(name);
      }
    }
  }
  return [...tables].slice(0, MAX_TABLES);
}

/** The total from a Content-Range header like `0-24/1240` or `*\/0`. */
export function rowCount(contentRange: string | undefined): number | undefined {
  const total = contentRange?.match(/\/(\d+)\s*$/)?.[1];
  return total === undefined ? undefined : Number(total);
}

export type TableKind = 'personal' | 'probably-public' | 'unknown';

const PERSONAL =
  /user|profile|account|member|customer|client|contact|email|subscriber|lead|order|payment|invoice|billing|transaction|message|chat|conversation|comment|note|address|phone|session|token|secret|password|credential|admin|employee|patient|student|booking|appointment|application|document|upload|private/i;
const PROBABLY_PUBLIC =
  /^(?:products?|posts?|articles?|categor(?:y|ies)|tags?|faqs?|pages?|blogs?|menus?|menu_items|items?|listings?|courses?|lessons?|events?|testimonials?|features?|plans?|pricing|prices?|pricing_plans|tiers?|announcements?)$/i;

/**
 * A guess from the name alone, used for severity. Some tables are meant to be read by
 * anyone, like a product list, so those are flagged more gently.
 */
export function tableKind(table: string): TableKind {
  if (PERSONAL.test(table)) return 'personal';
  if (PROBABLY_PUBLIC.test(table)) return 'probably-public';
  return 'unknown';
}
