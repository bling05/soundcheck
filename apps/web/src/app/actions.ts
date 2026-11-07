'use server';

import {
  countQueuedScans,
  countRecentScansBy,
  createScan,
  findRecentScan,
} from '@soundcheck/db';
import { parseScanUrl } from '@soundcheck/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  RECENT_SCAN_MINUTES,
  scanRefusal,
  visitorIp,
  visitorKey,
} from '@/server/limits';

export interface StartScanState {
  /** Shown under the form when the scan couldn't start. */
  message?: string;
}

const COULD_NOT_START = "We couldn't start the scan. Try again in a minute.";

/** Only the error's type and code: messages can include connection details. */
function describe(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (${code})` : name;
}

/**
 * Queues a scan of the link in the home page form, then goes to that scan's page. A link
 * scanned in the last few minutes goes to that scan instead, without counting as a new one.
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

  let destination: string;
  try {
    const recent = await findRecentScan(parsed.url, RECENT_SCAN_MINUTES);
    if (recent) {
      destination = `/scan/${recent}?recent`;
    } else {
      const visitor = visitorKey(visitorIp(await headers()));
      const refusal = scanRefusal({
        byVisitorLastHour: await countRecentScansBy(visitor, 60),
        queued: await countQueuedScans(),
      });
      if (refusal) return { message: refusal };
      destination = `/scan/${await createScan(parsed.url, visitor)}`;
    }
  } catch (error) {
    console.error('Could not queue a scan:', describe(error));
    return { message: COULD_NOT_START };
  }
  // Outside the try: redirect works by throwing, and that must not be caught.
  redirect(destination);
}
