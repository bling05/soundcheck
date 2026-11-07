import { checks, guardedFetch } from '@soundcheck/checks';
import {
  claimNextScan,
  closeDatabase,
  deleteExpiredData,
  failScan,
  failStuckScans,
  finishScan,
  requeueScan,
  saveProgress,
  setPlannedChecks,
} from '@soundcheck/db';
import { runScan, SCAN_TIME_LIMIT_MS } from './run-scan';

const POLL_MS = 2_000;
/** After a database error, wait longer before trying again. Neon may be waking up. */
const RETRY_MS = 10_000;
/** A scan running this long must belong to a worker that crashed. */
const STUCK_AFTER_MINUTES = Math.ceil(SCAN_TIME_LIMIT_MS / 60_000) + 7;
const STUCK_CHECK_MS = 60_000;
const CLEANUP_EVERY_MS = 60 * 60_000;

const FAILED_ON_OUR_SIDE =
  'Something went wrong on our side, so this scan stopped. Try scanning again in a minute.';

let stopping = false;
let current: string | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Only the error's type and code: messages can include connection details. */
function describe(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (${code})` : name;
}

async function scanOne(): Promise<boolean> {
  const scan = await claimNextScan();
  if (!scan) return false;

  current = scan.id;
  console.log(`Scanning ${scan.id}`);
  try {
    const result = await runScan(scan.url, {
      fetch: guardedFetch,
      checks,
      onPlanned: (planned) => setPlannedChecks(scan.id, planned),
      onProgress: (report) => saveProgress(scan.id, report),
    });
    if (result.ok) {
      await finishScan(scan.id, result.report);
      console.log(`Finished ${scan.id}`);
    } else {
      await failScan(scan.id, result.message);
      console.log(`Couldn't scan ${scan.id}: the site couldn't be reached.`);
    }
  } catch (error) {
    console.error(`Scan ${scan.id} failed:`, describe(error));
    await failScan(scan.id, FAILED_ON_OUR_SIDE).catch(() => {});
  } finally {
    current = undefined;
  }
  return true;
}

async function work(): Promise<void> {
  let nextStuckCheck = 0;
  let nextCleanup = 0;
  while (!stopping) {
    try {
      if (Date.now() >= nextStuckCheck) {
        const stuck = await failStuckScans(STUCK_AFTER_MINUTES);
        if (stuck > 0) console.log(`Marked ${stuck} stuck scans as failed.`);
        nextStuckCheck = Date.now() + STUCK_CHECK_MS;
      }
      if (Date.now() >= nextCleanup) {
        const removed = await deleteExpiredData();
        if (removed.scans > 0 || removed.requesters > 0) {
          console.log(
            `Deleted ${removed.scans} expired scans and cleared ${removed.requesters} old visitor codes.`,
          );
        }
        nextCleanup = Date.now() + CLEANUP_EVERY_MS;
      }
      const scanned = await scanOne();
      if (!scanned) await sleep(POLL_MS);
    } catch (error) {
      console.error('Database error:', describe(error));
      await sleep(RETRY_MS);
    }
  }
}

/** On Ctrl+C or a host shutdown, put an unfinished scan back in line for the next worker. */
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (current) {
    await requeueScan(current).catch(() => {});
    console.log(`Put ${current} back in the queue.`);
  }
  await closeDatabase().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

console.log(`Soundcheck worker started with ${checks.length} checks.`);
await work();
