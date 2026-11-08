import { checks } from '@soundcheck/checks';
import { deletionDate, failIfStuck, getScan } from '@soundcheck/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AutoRefresh } from '@/components/auto-refresh';
import { Report } from '@/components/report';
import { ScanProgress } from '@/components/scan-progress';
import { RECENT_SCAN_MINUTES } from '@/server/limits';

/** Well past the 3-minute scan limit, so only a scan that was cut off gets here. */
const STUCK_AFTER_MINUTES = 10;

/** Only offer verification once there's something it unlocks. */
const HAS_OWNER_CHECKS = checks.some(({ mode }) => mode === 'url-active');

export const metadata: Metadata = {
  title: 'Scan | Soundcheck',
  // Scan links are private unless someone shares them, so keep them out of search results.
  robots: { index: false },
};

export default async function ScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ recent?: string }>;
}) {
  // Every visit reads the latest state of the scan, so never serve a saved copy.
  await connection();
  const { id } = await params;
  const { recent } = await searchParams;
  let scan = await getScan(id);
  if (!scan) notFound();

  // A scan cut off by the host's time limit never marks itself finished. Fail it here so
  // its page doesn't say "running" forever.
  const unfinished = scan.status === 'queued' || scan.status === 'running';
  if (unfinished && (await failIfStuck(id, STUCK_AFTER_MINUTES))) {
    scan = (await getScan(id)) ?? scan;
  }

  const recentNotice = recent !== undefined && (
    <p className="notice">
      This site was scanned in the last few minutes, so this is that scan. You
      can start a new one after {RECENT_SCAN_MINUTES} minutes.
    </p>
  );

  if (scan.status === 'done' && scan.report) {
    return (
      <main className="report">
        {recentNotice}
        <Report report={scan.report} />
        {HAS_OWNER_CHECKS && !scan.report.verified && (
          <p>
            Own this site?{' '}
            <Link href={`/verify?site=${encodeURIComponent(scan.url)}`}>
              Verify it
            </Link>{' '}
            to run the database checks too.
          </p>
        )}
        <p className="muted">
          This report will be deleted on{' '}
          {deletionDate(scan.requestedAt).toLocaleDateString('en-US', {
            dateStyle: 'long',
            timeZone: 'UTC',
          })}
          .
        </p>
      </main>
    );
  }

  if (scan.status === 'failed') {
    return (
      <main className="report">
        <h1>{new URL(scan.url).hostname}</h1>
        <p>{scan.failure ?? 'This scan stopped before it finished.'}</p>
        <p>
          <Link href="/">Scan again</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="report">
      {recentNotice}
      <ScanProgress scan={scan} />
      <AutoRefresh />
    </main>
  );
}
