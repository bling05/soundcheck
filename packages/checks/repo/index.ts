import { createGunzip } from 'node:zlib';
import type { RepoRef, Technology } from '@soundcheck/shared';
import type { GuardedFetch } from '../request-guard';
import { TarReader } from './tar';

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

/**
 * A compressed repo bigger than this is refused rather than half read. Repos often carry
 * data files and images, and those are skipped while unpacking, so this only needs to
 * keep the download quick.
 */
export const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;
/** Unpacked, so a small archive can't expand forever. Skipped files still count. */
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;
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

// Data, media, and lock files. When one is too big to read it's skipped quietly: it isn't
// code, so leaving it out doesn't make the scan incomplete.
const NOT_CODE =
  /\.(?:csv|tsv|jsonl|ndjson|parquet|xlsx?|sqlite3?|db|h5|pkl|npy|npz|zip|tar|t?gz|bz2|7z|rar|pdf|png|jpe?g|gif|webp|avif|ico|svg|mp[34]|mov|wav|webm|woff2?|ttf|otf|ipynb|map|lock|log|txt|xml)$|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i;

/** Binary files have zero bytes early on. Text files never do. */
function isText(data: Buffer): boolean {
  return !data.subarray(0, 8000).includes(0);
}

/**
 * Reads the text files out of a GitHub tarball, which wraps everything in one folder. It
 * unpacks a piece at a time and skips what it doesn't keep as it streams past, so a repo
 * with hundreds of megabytes of data files never has to fit in memory.
 */
export function filesFromArchive(
  gzipped: Buffer,
): Promise<{ files: RepoFile[]; filesSkipped: number }> {
  return new Promise((resolve, reject) => {
    const files: RepoFile[] = [];
    let filesSkipped = 0;
    let unpacked = 0;
    const gunzip = createGunzip();
    const finish = () => resolve({ files, filesSkipped });

    const reader = new TarReader({
      wants(fullPath, size) {
        const path = fullPath.split('/').slice(1).join('/');
        if (!path || isSkippedPath(path)) return false;
        if (size > MAX_FILE_BYTES || files.length >= MAX_FILES) {
          if (!NOT_CODE.test(path)) filesSkipped++;
          return false;
        }
        return true;
      },
      onFile({ path: fullPath, data }) {
        if (!isText(data)) return;
        const path = fullPath.split('/').slice(1).join('/');
        files.push({ path, text: data.toString('utf8') });
      },
    });

    gunzip.on('data', (chunk: Buffer) => {
      unpacked += chunk.length;
      if (unpacked > MAX_UNPACKED_BYTES) {
        gunzip.destroy();
        reject(new Error('Repo is too big once unpacked'));
        return;
      }
      reader.push(chunk);
      if (reader.done) {
        gunzip.destroy();
        finish();
      }
    });
    gunzip.on('end', finish);
    gunzip.on('error', reject);
    gunzip.end(gzipped);
  });
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

  let read: Awaited<ReturnType<typeof filesFromArchive>>;
  try {
    read = await filesFromArchive(response.body);
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
