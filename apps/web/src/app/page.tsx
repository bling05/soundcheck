import Link from 'next/link';
import { ScanForm } from '@/components/scan-form';

// Submitting the form runs the whole scan in the background of the same request, so it
// gets the longest time Vercel's free plan allows. Scans stop themselves at 3 minutes.
export const maxDuration = 300;

export default function HomePage() {
  return (
    <main className="home">
      <h1>Soundcheck</h1>
      <p className="lede">
        A free, open-source security scanner for apps built with Lovable, Bolt,
        Cursor, and Claude. Scan a URL, a GitHub repo, or both, then learn how
        to fix what it finds.
      </p>
      <ScanForm />

      <h2>Features</h2>
      <ul>
        <li>
          One prompt that fixes everything. Paste it into Lovable, Cursor, or
          Bolt.
        </li>
        <li>An explanation of every problem it finds.</li>
        <li>Scans your code and your live site.</li>
        <li>Rescan to see what&apos;s fixed.</li>
      </ul>
      <p>
        <Link href="/learn">Learn how these problems work</Link>
      </p>
    </main>
  );
}
