import { findingId, sortBySeverity, type Finding } from '@soundcheck/report';
import type { GuardedFetch } from '../request-guard';
import { readSite } from '../site-files';
import {
  findSupabaseProject,
  type SupabaseProject,
} from '../supabase-rls/rules';
import type { Check, CheckContext, CheckResult } from '../types';
import {
  detailFor,
  fixRequestFor,
  manualFixFor,
  SEVERITY,
  titleFor,
} from './content';
import { bucketKind, entryCount, findBucketNames, LIST_LIMIT } from './rules';

const CHECK_ID = 'supabase-storage';
/** A list of 100 names is small. Anything bigger isn't worth reading. */
const MAX_LIST_BYTES = 256 * 1024;

type BucketResult =
  | { bucket: string; state: 'listable'; entries: number }
  /** Answered with an empty list: empty, protected, or no such bucket. We can't tell. */
  | { bucket: string; state: 'empty' }
  | { bucket: string; state: 'protected' }
  | { bucket: string; state: 'unknown' };

/**
 * Asks for the first page of file names in a bucket, the way the app's own code would.
 * Only the number of names is kept: the names themselves can be personal, so they're
 * dropped here and never reach the report. No file is ever downloaded.
 */
async function listBucket(
  project: SupabaseProject,
  bucket: string,
  fetch: GuardedFetch,
): Promise<BucketResult> {
  const response = await fetch(
    `${project.url}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
    {
      method: 'POST',
      json: { prefix: '', limit: LIST_LIMIT, offset: 0 },
      maxBytes: MAX_LIST_BYTES,
      headers: {
        apikey: project.key,
        ...(project.isToken && { authorization: `Bearer ${project.key}` }),
      },
    },
  );
  if (!response.ok) return { bucket, state: 'unknown' };
  if (response.status === 401 || response.status === 403) {
    return { bucket, state: 'protected' };
  }
  if (response.status !== 200 || response.truncated) {
    return { bucket, state: 'unknown' };
  }

  const entries = entryCount(response.body.toString('utf8'));
  if (entries === undefined) return { bucket, state: 'unknown' };
  return entries > 0
    ? { bucket, state: 'listable', entries }
    : { bucket, state: 'empty' };
}

function findingFor(project: SupabaseProject, bucket: string, entries: number) {
  const kind = bucketKind(bucket);
  const title = titleFor(bucket, kind);
  return {
    id: findingId(CHECK_ID, 'listable-bucket', bucket),
    checkId: CHECK_ID,
    title,
    severity: SEVERITY[kind],
    source: 'live',
    evidence: [
      {
        kind: 'url',
        url: `${project.url}/storage/v1/object/list/${bucket}`,
        detail: detailFor(entries),
      },
    ],
    lessonId: `${CHECK_ID}:listable-bucket`,
    manualFix: manualFixFor(bucket, kind),
    aiFix: { problem: title, request: fixRequestFor(bucket, kind) },
  } satisfies Finding;
}

function noteFor(results: readonly BucketResult[]): string | undefined {
  const unclear = results.filter(
    ({ state }) => state === 'empty' || state === 'unknown',
  );
  if (unclear.length === 0) return undefined;
  const names = unclear.map(({ bucket }) => bucket).join(', ');
  const one = unclear.length === 1;
  return `We couldn't tell whether ${one ? 'this storage bucket is' : 'these storage buckets are'} protected: ${names}. Either we couldn't see any files, which can mean ${one ? "it's" : "they're"} empty rather than protected, or Supabase didn't answer.`;
}

async function run(context: CheckContext): Promise<CheckResult> {
  if (!context.url) {
    return {
      status: 'skipped',
      reason: 'This check needs a link to your site.',
    };
  }

  const site = await readSite(context.url, context.fetch);
  if (!site.ok) return { status: 'skipped', reason: site.message };

  const project = findSupabaseProject(site.files);
  if (!project) {
    return {
      status: 'skipped',
      reason:
        "We couldn't find your Supabase project's address and public key in your site's code.",
    };
  }
  const buckets = findBucketNames(site.files);
  if (buckets.length === 0) {
    return {
      status: 'skipped',
      reason:
        "We couldn't find any Supabase file storage buckets in your site's code.",
    };
  }

  const results: BucketResult[] = [];
  for (const bucket of buckets) {
    results.push(await listBucket(project, bucket, context.fetch));
  }

  const findings = sortBySeverity(
    results.flatMap((result) =>
      result.state === 'listable'
        ? [findingFor(project, result.bucket, result.entries)]
        : [],
    ),
  );
  const note = noteFor(results);

  // Nothing found while some buckets were unclear must never look like a pass.
  if (findings.length === 0 && note) return { status: 'skipped', reason: note };
  return note ? { status: 'ran', findings, note } : { status: 'ran', findings };
}

export const supabaseStorage: Check = {
  id: CHECK_ID,
  title: 'Supabase file storage anyone can list',
  // Sends requests to the site's storage, so it only runs for verified owners.
  mode: 'url-active',
  platforms: ['supabase'],
  run,
};
