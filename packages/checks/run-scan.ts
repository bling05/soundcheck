import type { CheckOutcome, ScanReport } from '@soundcheck/report';
import { repoLabel, type Platform, type RepoRef } from '@soundcheck/shared';
import { fingerprintSite, type Technology } from './fingerprint';
import { downloadRepo, technologiesInRepo } from './repo';
import { withRequestCache, type GuardedFetch } from './request-guard';
import type { Check, CheckResult } from './types';
import { checkVerification } from './verification';

/** A check a scan will run, so a progress page can list it before it finishes. */
export interface PlannedCheck {
  id: string;
  title: string;
}

/** Longest one check may take before we stop waiting for it. */
export const CHECK_TIME_LIMIT_MS = 60_000;
/** Longest a whole scan may take. Checks that haven't started by then are skipped. */
export const SCAN_TIME_LIMIT_MS = 3 * 60_000;

const DATABASE_RULES = {
  title: 'Database and storage rules',
  reason:
    'Testing these goes further than reading public files, so it needs proof that you own this site. Verify your site to unlock these checks.',
};

/** Says why verifying matters on a Supabase site, without revealing anything about it. */
const SUPABASE_TABLES = {
  title: 'Supabase tables and files anyone can read',
  reason:
    "This site uses Supabase. The most common serious problems in Supabase apps are tables anyone can read and file storage anyone can list, and both have leaked real users' data. Checking needs proof that you own this site, so verify it to check yours.",
};

/** The same, for a Firebase site. */
const FIREBASE_RULES = {
  title: 'Firebase databases and files anyone can read',
  reason:
    "This site uses Firebase. The most common serious problem in Firebase apps is security rules left open on the database or file storage, like test mode, which has leaked millions of people's data. Checking needs proof that you own this site, so verify it to check yours.",
};

/** Kinds of checks a URL scan never tries. Shown in every report's "couldn't check" list. */
const YOUR_CODE = {
  title: 'Your code',
  reason:
    'Problems like missing ownership checks only show up in your code. Add your repo link to check it.',
};

const LOGIN_PAGES = {
  title: 'Pages behind a login',
  reason: 'We only read what a logged-out visitor can see.',
};

export const NOT_ATTEMPTED: ScanReport['notAttempted'] = [
  DATABASE_RULES,
  YOUR_CODE,
  LOGIN_PAGES,
];

const CRASHED =
  "Something went wrong in this check on our side, so it didn't finish.";
const TIMED_OUT = 'This check took too long, so we stopped waiting for it.';
const OUT_OF_TIME = 'The scan ran out of time before this check could run.';

export interface RunScanOptions {
  fetch: GuardedFetch;
  checks: readonly Check[];
  /**
   * The site's verification code, if the person scanning holds the secret behind it. When
   * the site shows this code, checks that need proof of ownership run too.
   */
  verificationCode?: string;
  /** Where repos are downloaded from. Tests point it at a fake server. */
  repoBase?: string;
  /** Called once with the checks that will run, before the first one starts. */
  onPlanned?: (checks: PlannedCheck[]) => Promise<void>;
  /** Called with the report so far after each check finishes. */
  onProgress?: (report: ScanReport) => Promise<void>;
  checkTimeLimitMs?: number;
  scanTimeLimitMs?: number;
  now?: () => number;
}

export type RunScanResult =
  | { ok: true; report: ScanReport }
  /** `message` is shown to the user. */
  | { ok: false; message: string };

const TIMEOUT = Symbol('timeout');

/**
 * Stops waiting after `ms`. The check itself can't be cancelled, but every request it
 * makes has its own time limit, so a late one finishes soon and its result is ignored.
 */
async function withTimeLimit<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * URL checks need a site, and active ones a verified site. Repo checks need a repo. Each
 * also needs the platform it's for, found on the site or in the repo.
 */
function appliesTo(
  check: Check,
  stack: readonly string[],
  has: { url: boolean; repo: boolean; verified: boolean },
): boolean {
  if (check.mode === 'repo' && !has.repo) return false;
  if (check.mode !== 'repo' && !has.url) return false;
  if (check.mode === 'url-active' && !has.verified) return false;
  return (
    check.platforms === 'all' ||
    check.platforms.some((platform) => stack.includes(platform))
  );
}

function outcomeFor(check: Check, result: CheckResult): CheckOutcome {
  return { checkId: check.id, title: check.title, ...result };
}

function skipped(check: Check, reason: string): CheckOutcome {
  return { checkId: check.id, title: check.title, status: 'skipped', reason };
}

/** What to scan: a site, a repo, or both. */
export interface ScanTarget {
  url?: string;
  repo?: RepoRef;
}

/**
 * Fingerprints the site and downloads the repo, whichever were given, then runs every
 * check that applies, one at a time.
 */
export async function runScan(
  target: string | ScanTarget,
  options: RunScanOptions,
): Promise<RunScanResult> {
  const { url, repo: repoRef } =
    typeof target === 'string' ? { url: target, repo: undefined } : target;
  if (!url && !repoRef) {
    return {
      ok: false,
      message: 'Give a link to your site, your repo, or both.',
    };
  }
  const now = options.now ?? Date.now;
  const checkLimit = options.checkTimeLimitMs ?? CHECK_TIME_LIMIT_MS;
  const deadline = now() + (options.scanTimeLimitMs ?? SCAN_TIME_LIMIT_MS);

  // One download of each page per scan, shared by fingerprinting and every check.
  const fetch = withRequestCache(options.fetch);

  const fingerprint = url ? await fingerprintSite(url, fetch) : undefined;
  if (fingerprint && !fingerprint.ok) {
    return { ok: false, message: fingerprint.message };
  }

  const download = repoRef
    ? await downloadRepo(repoRef, options.fetch, options.repoBase)
    : undefined;
  // A repo that can't be read ends a repo-only scan. With a site too, the site is still
  // scanned and the report says why the code wasn't.
  if (download && !download.ok && !url) {
    return { ok: false, message: download.message };
  }
  const repo = download?.ok ? download.snapshot : undefined;

  const stack: Technology[] = [
    ...new Set([
      ...(fingerprint?.ok
        ? fingerprint.detections.map(({ technology }) => technology)
        : []),
      ...(repo ? technologiesInRepo(repo.files) : []),
    ]),
  ];
  const platforms = stack.filter(
    (technology): technology is Platform =>
      technology === 'supabase' || technology === 'firebase',
  );
  // Checked again on every scan, so taking the code off the site ends verification.
  const verified =
    url !== undefined &&
    options.verificationCode !== undefined &&
    (await checkVerification(url, options.verificationCode, fetch)).verified;

  const checks = options.checks.filter((check) =>
    appliesTo(check, stack, {
      url: url !== undefined,
      repo: repo !== undefined,
      verified,
    }),
  );
  await options.onPlanned?.(checks.map(({ id, title }) => ({ id, title })));

  const sitePlatforms = fingerprint?.ok ? fingerprint.platforms : [];
  const notAttempted = [
    ...(url && !verified && sitePlatforms.includes('supabase')
      ? [SUPABASE_TABLES]
      : []),
    ...(url && !verified && sitePlatforms.includes('firebase')
      ? [FIREBASE_RULES]
      : []),
    ...NOT_ATTEMPTED.filter((item) => {
      if (item === DATABASE_RULES) return url !== undefined && !verified;
      if (item === LOGIN_PAGES) return url !== undefined;
      if (item === YOUR_CODE) return repo === undefined;
      return true;
    }).map((item) =>
      item === YOUR_CODE && download && !download.ok
        ? { title: item.title, reason: download.message }
        : item,
    ),
  ];

  const report: ScanReport = {
    ...(url && { url }),
    ...(repoRef && { repo: repoLabel(repoRef) }),
    scannedAt: new Date(now()).toISOString(),
    ...(fingerprint?.ok && fingerprint.tool && { tool: fingerprint.tool }),
    ...(stack.length > 0 && { stack }),
    verified,
    outcomes: [],
    notAttempted,
  };

  for (const check of checks) {
    const timeLeft = deadline - now();
    if (timeLeft <= 0) {
      report.outcomes.push(skipped(check, OUT_OF_TIME));
      continue;
    }
    try {
      const result = await withTimeLimit(
        check.run({
          ...(url && { url }),
          ...(repo && { repo }),
          fetch,
          platforms,
          technologies: stack,
        }),
        Math.min(checkLimit, timeLeft),
      );
      report.outcomes.push(
        result === TIMEOUT
          ? skipped(check, TIMED_OUT)
          : outcomeFor(check, result),
      );
    } catch (error) {
      // Only the error's type: its message could quote what the site sent back.
      console.error(
        `Check ${check.id} crashed:`,
        error instanceof Error ? error.name : typeof error,
      );
      report.outcomes.push(skipped(check, CRASHED));
    }
    await options.onProgress?.(report);
  }

  return { ok: true, report };
}
