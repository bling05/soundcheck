import type {
  Check,
  CheckResult,
  GuardedFetch,
  Technology,
} from '@soundcheck/checks';
import { fingerprintSite, withRequestCache } from '@soundcheck/checks';
import type { PlannedCheck } from '@soundcheck/db';
import type { CheckOutcome, ScanReport } from '@soundcheck/report';

/** Longest one check may take before we stop waiting for it. */
export const CHECK_TIME_LIMIT_MS = 60_000;
/** Longest a whole scan may take. Checks that haven't started by then are skipped. */
export const SCAN_TIME_LIMIT_MS = 3 * 60_000;

/** Kinds of checks a URL scan never tries. Shown in every report's "couldn't check" list. */
export const NOT_ATTEMPTED: ScanReport['notAttempted'] = [
  {
    title: 'Database and storage rules',
    reason:
      "Testing these goes further than reading public files, so it needs proof that you own this domain. Domain verification isn't available yet.",
  },
  {
    title: 'Your code',
    reason:
      "Problems like missing ownership checks only show up in your code, and repo scans aren't available yet.",
  },
  {
    title: 'Pages behind a login',
    reason: 'We only read what a logged-out visitor can see.',
  },
];

const CRASHED =
  "Something went wrong in this check on our side, so it didn't finish.";
const TIMED_OUT = 'This check took too long, so we stopped waiting for it.';
const OUT_OF_TIME = 'The scan ran out of time before this check could run.';

export interface RunScanOptions {
  fetch: GuardedFetch;
  checks: readonly Check[];
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

/** URL scans run passive checks only. Active checks need domain verification first. */
function appliesTo(check: Check, platforms: readonly string[]): boolean {
  if (check.mode !== 'url-passive') return false;
  return (
    check.platforms === 'all' ||
    check.platforms.some((platform) => platforms.includes(platform))
  );
}

function outcomeFor(check: Check, result: CheckResult): CheckOutcome {
  return { checkId: check.id, title: check.title, ...result };
}

function skipped(check: Check, reason: string): CheckOutcome {
  return { checkId: check.id, title: check.title, status: 'skipped', reason };
}

/** Fingerprints a site, then runs every check that applies to it, one at a time. */
export async function runScan(
  url: string,
  options: RunScanOptions,
): Promise<RunScanResult> {
  const now = options.now ?? Date.now;
  const checkLimit = options.checkTimeLimitMs ?? CHECK_TIME_LIMIT_MS;
  const deadline = now() + (options.scanTimeLimitMs ?? SCAN_TIME_LIMIT_MS);

  // One download of each page per scan, shared by fingerprinting and every check.
  const fetch = withRequestCache(options.fetch);

  const fingerprint = await fingerprintSite(url, fetch);
  if (!fingerprint.ok) return { ok: false, message: fingerprint.message };

  const stack: Technology[] = [
    ...new Set(fingerprint.detections.map(({ technology }) => technology)),
  ];
  const checks = options.checks.filter((check) =>
    appliesTo(check, fingerprint.platforms),
  );
  await options.onPlanned?.(checks.map(({ id, title }) => ({ id, title })));

  const report: ScanReport = {
    url,
    scannedAt: new Date(now()).toISOString(),
    ...(fingerprint.tool && { tool: fingerprint.tool }),
    ...(stack.length > 0 && { stack }),
    outcomes: [],
    notAttempted: NOT_ATTEMPTED,
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
          url,
          fetch,
          platforms: fingerprint.platforms,
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
