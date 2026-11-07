import { deletionDate, getScan, scansAhead } from '@soundcheck/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AutoRefresh } from '@/components/auto-refresh';
import { Report } from '@/components/report';
import { ScanProgress } from '@/components/scan-progress';
import { RECENT_SCAN_MINUTES } from '@/server/limits';

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
  const scan = await getScan(id);
  if (!scan) notFound();

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
      <ScanProgress scan={scan} ahead={await scansAhead(scan)} />
      <AutoRefresh />
    </main>
  );
}
