import type { Metadata } from 'next';
import { Report } from '@/components/report';
import { SAMPLE_REPORT } from './sample-report';

export const metadata: Metadata = {
  title: 'Sample report | Soundcheck',
  robots: { index: false },
};

export default function SampleReportPage() {
  return (
    <main className="report">
      <p className="notice">
        This is a sample report with made-up results. No real site was scanned.
      </p>
      <Report report={SAMPLE_REPORT} />
    </main>
  );
}
