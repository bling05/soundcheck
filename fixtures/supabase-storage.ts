import type { FixtureSite } from './server';
import { ANON_KEY } from './supabase-rls';

const page = `<!doctype html><head><script type="module" src="/assets/app.js"></script></head><h1>Hi</h1>`;

/**
 * App code that uses Supabase storage at `projectUrl`. The fake storage runs on the same
 * fixture server, so call this after the server has started and its address is known.
 */
export function storageAppCode(
  projectUrl: string,
  buckets: readonly string[],
): string {
  return [
    `const db = createClient("${projectUrl}", "${ANON_KEY}");`,
    ...buckets.map((bucket) => `db.storage.from("${bucket}").upload(f);`),
    // A table, not a bucket. It must never be listed as one.
    'db.from("profiles").select("*");',
  ].join('\n');
}

/** A made-up file list. The names look personal on purpose, to prove none are kept. */
const files = (count: number) =>
  JSON.stringify(
    Array.from({ length: count }, (_, index) => ({
      name: `jane-doe-passport-${index}.jpg`,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    })),
  );

const list = (path: string) => `/storage/v1/object/list/${path}`;

/**
 * Supabase storage with one of each kind of bucket: ID photos anyone can list, product
 * photos anyone can list, a protected bucket, and one that answered with nothing.
 */
export const leakyBuckets: FixtureSite = {
  '/': { body: page },
  [list('id-documents')]: { body: files(37) },
  [list('product-images')]: { body: files(150) },
  [list('avatars')]: { status: 403, body: '{"error":"Unauthorized"}' },
  [list('empty')]: { body: '[]' },
};
export const LEAKY_BUCKETS = [
  'id-documents',
  'product-images',
  'avatars',
  'empty',
];
