'use server';

import {
  countActiveScans,
  countRecentScansBy,
  createScan,
  findRecentScan,
} from '@soundcheck/db';
import { REPO_SCANS_READY, verificationCode } from '@soundcheck/checks';
import {
  parseRepoUrl,
  parseScanUrl,
  repoLabel,
  type RepoRef,
} from '@soundcheck/shared';
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
  const urlInput = String(form.get('url') ?? '').trim();
  const repoInput = String(form.get('repo') ?? '').trim();
  if (!urlInput && !repoInput) {
    return { message: "Enter your app's link, your repo's link, or both." };
  }

  let repo: string | undefined;
  let repoRef: RepoRef | undefined;
  if (repoInput) {
    // Opens by itself once the first check that reads code exists.
    if (!REPO_SCANS_READY()) {
      return {
        message:
          "Repo scans aren't ready yet. Leave the repo link empty to scan just your site.",
      };
    }
    const parsedRepo = parseRepoUrl(repoInput);
    if (!parsedRepo.ok) return { message: parsedRepo.message };
    repoRef = parsedRepo.repo;
    repo = repoLabel(repoRef);
  }

  let url: string | undefined;
  if (urlInput) {
    const parsed = parseScanUrl(urlInput);
    if (!parsed.ok) return { message: parsed.message };
    url = parsed.url;
  }

  // Someone holding a verification secret may own this site, so their scan can include
  // database results. It's never reused for anyone else, and never reuses another scan.
  const secret = await readVerificationSecret();
  const code = url && secret && verificationCode(secret, new URL(url).hostname);

  let destination: string;
  try {
    // Only a scan of the site alone is reused. A repo is always read fresh.
    const recent =
      code || repo || !url
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
      const id = await createScan(
        { ...(url && { url }), ...(repo && { repo }) },
        visitor,
        { private: Boolean(code) },
      );
      // Runs after the visitor has been sent to the scan page.
      after(() =>
        runQueuedScan(
          id,
          { ...(url && { url }), ...(repoRef && { repo: repoRef }) },
          code || undefined,
        ),
      );
      destination = `/scan/${id}`;
    }
  } catch (error) {
    console.error('Could not queue a scan:', describeError(error));
    return { message: COULD_NOT_START };
  }
  // Outside the try: redirect works by throwing, and that must not be caught.
  redirect(destination);
}
