import type { SiteFile } from '../site-files';

// `supabase.storage.from('avatars')`, the way app code names a file bucket.
const STORAGE_FROM =
  /\bstorage\s*\.from\(\s*["'`]([A-Za-z0-9_.-]{1,63})["'`]\s*\)/g;
// A file link the app builds or shows, like `/storage/v1/object/public/avatars/me.png`.
const FILE_LINK =
  /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([A-Za-z0-9_.-]{1,63})\//g;
/** Each bucket is one request, so a scan stays short. */
export const MAX_BUCKETS = 10;
/** How many names one list request asks for. Enough to prove the point, no more. */
export const LIST_LIMIT = 100;

/** The bucket names the site's code uses, in the order first seen. */
export function findBucketNames(files: readonly SiteFile[]): string[] {
  const buckets = new Set<string>();
  for (const { text } of files) {
    for (const pattern of [STORAGE_FROM, FILE_LINK]) {
      for (const [, name] of text.matchAll(pattern)) {
        if (name && name !== '.' && name !== '..') buckets.add(name);
      }
    }
  }
  return [...buckets].slice(0, MAX_BUCKETS);
}

/** How many entries a list response holds, or undefined if it isn't a list. */
export function entryCount(body: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? parsed.length : undefined;
  } catch {
    return undefined;
  }
}

export type BucketKind = 'personal' | 'probably-public' | 'unknown';

const PERSONAL =
  /\bid\b|^ids?[_-]|[_-]ids?$|identit|verif|kyc|passport|licen[cs]e|document|\bdocs?\b|private|receipt|invoice|medical|health|backup|attachment|message|chat|contract|selfie|resume|cv\b|payslip|tax/i;
const PROBABLY_PUBLIC =
  /^(?:public|assets?|static|images?|media|products?|product[_-]images|blog|logos?|banners?|marketing|thumbnails?|icons?)$/i;

/**
 * A guess from the name alone, used for severity. Documents and IDs are the worst case;
 * a bucket of product photos is probably meant to be seen.
 */
export function bucketKind(bucket: string): BucketKind {
  if (PERSONAL.test(bucket)) return 'personal';
  if (PROBABLY_PUBLIC.test(bucket)) return 'probably-public';
  return 'unknown';
}
