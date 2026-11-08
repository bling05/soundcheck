import { checks, guardedFetch, runScan } from '@soundcheck/checks';
import {
  failScan,
  finishScan,
  markRunning,
  saveProgress,
  setPlannedChecks,
} from '@soundcheck/db';

const FAILED_ON_OUR_SIDE =
  'Something went wrong on our side, so this scan stopped. Try scanning again in a minute.';

/** Only the error's type and code: messages can include connection details. */
export function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (${code})` : name;
}

/**
 * Runs a queued scan to the end, saving progress after each check so the scan page can
 * show it. Call it inside `after()`, so the visitor is already on the scan page while it
 * runs. The whole scan must fit in the function's time limit (`maxDuration`), which is why
 * scans are capped at 3 minutes.
 */
export async function runQueuedScan(
  id: string,
  url: string,
  verificationCode?: string,
): Promise<void> {
  try {
    if (!(await markRunning(id))) return;
    const result = await runScan(url, {
      fetch: guardedFetch,
      checks,
      verificationCode,
      onPlanned: (planned) => setPlannedChecks(id, planned),
      onProgress: (report) => saveProgress(id, report),
    });
    if (result.ok) await finishScan(id, result.report);
    else await failScan(id, result.message);
  } catch (error) {
    console.error(`Scan ${id} failed:`, describeError(error));
    await failScan(id, FAILED_ON_OUR_SIDE).catch(() => {});
  }
}
