import { PUBLIC_VALUES } from './bundle-secrets';
import type { FixtureSite } from './server';

/** The public key the fake app ships, like a real Supabase app does. */
export const ANON_KEY = PUBLIC_VALUES.supabaseAnon;

const page = `<!doctype html><head><script type="module" src="/assets/app.js"></script></head><h1>Hi</h1>`;

/**
 * App code that talks to a Supabase project at `projectUrl`. The fake database runs on the
 * same fixture server, so call this after the server has started and its address is known.
 */
export function appCode(projectUrl: string, tables: readonly string[]): string {
  return [
    `const db = createClient("${projectUrl}", "${ANON_KEY}");`,
    ...tables.map((table) => `db.from("${table}").select("*");`),
    // A file bucket, not a table. It must never be counted.
    'db.storage.from("avatars").upload(file);',
  ].join('\n');
}

const count = (total: number) => ({
  status: 200,
  headers: { 'content-range': total > 0 ? `0-${total - 1}/${total}` : '*/0' },
});

/**
 * A Supabase app with one of each kind of table: personal data anyone can read, a product
 * list anyone can read, a protected table, an empty table, and a name that isn't a table.
 */
export const leakyTables: FixtureSite = {
  '/': { body: page },
  '/rest/v1/profiles': count(1240),
  '/rest/v1/products': count(12),
  '/rest/v1/private_notes': { status: 401, body: '{"code":"42501"}' },
  '/rest/v1/empty_table': count(0),
  '/rest/v1/not_a_table': { status: 404 },
};
export const LEAKY_TABLES = [
  'profiles',
  'products',
  'private_notes',
  'empty_table',
  'not_a_table',
];

/** Every table refuses the public key. */
export const protectedTables: FixtureSite = {
  '/': { body: page },
  '/rest/v1/profiles': { status: 401 },
  '/rest/v1/messages': { status: 403 },
};
export const PROTECTED_TABLES = ['profiles', 'messages'];
