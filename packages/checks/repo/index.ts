import { gunzipSync } from 'node:zlib';
import type { RepoRef, Technology } from '@soundcheck/shared';
import type { GuardedFetch } from '../request-guard';
import { readTar } from './tar';

export interface RepoFile {
  /** Relative to the repo root, like `supabase/migrations/001.sql`. */
  path: string;
  text: string;
}

export interface RepoSnapshot {
  repo: RepoRef;
  /** The repo's text files, minus folders like node_modules. Held only while a scan runs. */
  files: RepoFile[];
  /** False if some files were left out for size, so nothing found doesn't mean nothing there. */
  complete: boolean;
  filesSkipped: number;
}

export type RepoDownload =
  { ok: true; snapshot: RepoSnapshot } | { ok: false; message: string };

/** A compressed repo bigger than this is refused rather than half read. */
export const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
/** Uncompressed, so a small archive can't expand into something huge. */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 5000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

// Installed or generated code, not the app's own. Reading it would be slow and its
// problems aren't the owner's to fix.
const SKIPPED_FOLDERS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  'vendor',
  '.vercel',
  '.turbo',
  '.cache',
]);

function isSkippedPath(path: string): boolean {
  return path.split('/').some((part) => SKIPPED_FOLDERS.has(part));
}

/** Binary files have zero bytes early on. Text files never do. */
function isText(data: Buffer): boolean {
  return !data.subarray(0, 8000).includes(0);
}

/** Reads the text files out of a GitHub tarball, which wraps everything in one folder. */
export function filesFromArchive(gzipped: Buffer): {
  files: RepoFile[];
  filesSkipped: number;
} {
  const archive = gunzipSync(gzipped, { maxOutputLength: MAX_UNPACKED_BYTES });
  const files: RepoFile[] = [];
  let filesSkipped = 0;
  for (const { path: fullPath, data } of readTar(archive)) {
    const path = fullPath.split('/').slice(1).join('/');
    if (!path || isSkippedPath(path)) continue;
    if (data.length > MAX_FILE_BYTES || files.length >= MAX_FILES) {
      filesSkipped++;
      continue;
    }
    if (!isText(data)) continue;
    files.push({ path, text: data.toString('utf8') });
  }
  return { files, filesSkipped };
}

/**
 * Downloads a public GitHub repo's default branch as one archive, through the guard, and
 * reads it in memory. Nothing is installed, built, or run, and nothing is written to disk.
 */
export async function downloadRepo(
  repo: RepoRef,
  fetch: GuardedFetch,
  base = 'https://codeload.github.com',
): Promise<RepoDownload> {
  const response = await fetch(
    `${base}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/tar.gz/HEAD`,
    { maxBytes: MAX_DOWNLOAD_BYTES, timeoutMs: DOWNLOAD_TIMEOUT_MS },
  );
  if (!response.ok) return { ok: false, message: response.message };
  if (response.status === 404) {
    return {
      ok: false,
      message:
        "We couldn't find that repo. Check the link, and note that only public repos can be scanned for now.",
    };
  }
  if (response.status !== 200) {
    return {
      ok: false,
      message: `GitHub answered with error ${response.status}, so we couldn't download the repo. Try again in a minute.`,
    };
  }
  if (response.truncated) {
    return {
      ok: false,
      message: 'This repo is too big for us to scan right now.',
    };
  }

  let read: ReturnType<typeof filesFromArchive>;
  try {
    read = filesFromArchive(response.body);
  } catch {
    return {
      ok: false,
      message:
        "We couldn't read the repo GitHub sent us. It may be too big once unpacked.",
    };
  }
  return {
    ok: true,
    snapshot: {
      repo,
      files: read.files,
      complete: read.filesSkipped === 0,
      filesSkipped: read.filesSkipped,
    },
  };
}

// Packages that tell us what the app is built with, so the right checks run.
const PACKAGE_TECHNOLOGIES: Record<string, Technology> = {
  '@supabase/supabase-js': 'supabase',
  '@supabase/ssr': 'supabase',
  firebase: 'firebase',
  'firebase-admin': 'firebase',
  next: 'nextjs',
  vite: 'vite',
};

/** What the repo is built with, from its package.json files, in a fixed order. */
export function technologiesInRepo(files: readonly RepoFile[]): Technology[] {
  const found = new Set<Technology>();
  for (const { path, text } of files) {
    if (path !== 'package.json' && !path.endsWith('/package.json')) continue;
    let manifest: unknown;
    try {
      manifest = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof manifest !== 'object' || manifest === null) continue;
    for (const field of ['dependencies', 'devDependencies']) {
      const deps = (manifest as Record<string, unknown>)[field];
      if (typeof deps !== 'object' || deps === null) continue;
      for (const name of Object.keys(deps)) {
        const technology = PACKAGE_TECHNOLOGIES[name];
        if (technology) found.add(technology);
      }
    }
  }
  const order: Technology[] = ['supabase', 'firebase', 'nextjs', 'vite'];
  return order.filter((technology) => found.has(technology));
}
