'use server';

import {
  countActiveScans,
  countRecentScansBy,
  createScan,
  findRecentScan,
} from '@soundcheck/db';
import { verificationCode } from '@soundcheck/checks';
import { parseScanUrl } from '@soundcheck/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import {
  RECENT_SCAN_MINUTES,
  scanRefusal,
  visitorIp,
  visitorKey,
} from '@/server/limits';
import { describeError, runQueuedScan } from '@/server/run-scan';
import { readVerificationSecret } from '@/server/verification';

export interface StartScanState {
  /** Shown under the form when the scan couldn't start. */
  message?: string;
}

const COULD_NOT_START = "We couldn't start the scan. Try again in a minute.";

/**
 * Queues a scan of the link in the home page form, goes to that scan's page, and runs the
 * scan in the background. A link scanned in the last few minutes goes to that scan
 * instead, without counting as a new one.
 */
export async function startScan(
  _previous: StartScanState,
  form: FormData,
): Promise<StartScanState> {
  const repo = form.get('repo');
  if (typeof repo === 'string' && repo.trim() !== '') {
    return {
      message:
        "Repo scans aren't ready yet. Leave the repo link empty to scan just your site.",
    };
  }

  const parsed = parseScanUrl(String(form.get('url') ?? ''));
  if (!parsed.ok) return { message: parsed.message };
  const url = parsed.url;

  // Someone holding a verification secret may own this site, so their scan can include
  // database results. It's never reused for anyone else, and never reuses another scan.
  const secret = await readVerificationSecret();
  const code = secret && verificationCode(secret, new URL(url).hostname);

  let destination: string;
  try {
    const recent = code
      ? undefined
      : await findRecentScan(url, RECENT_SCAN_MINUTES);
    if (recent) {
      destination = `/scan/${recent}?recent`;
    } else {
      const visitor = visitorKey(visitorIp(await headers()));
      const refusal = scanRefusal({
        byVisitorLastHour: await countRecentScansBy(visitor, 60),
        active: await countActiveScans(),
      });
      if (refusal) return { message: refusal };
      const id = await createScan(url, visitor, { private: Boolean(code) });
      // Runs after the visitor has been sent to the scan page.
      after(() => runQueuedScan(id, url, code));
      destination = `/scan/${id}`;
    }
  } catch (error) {
    console.error('Could not queue a scan:', describeError(error));
    return { message: COULD_NOT_START };
  }
  // Outside the try: redirect works by throwing, and that must not be caught.
  redirect(destination);
}
