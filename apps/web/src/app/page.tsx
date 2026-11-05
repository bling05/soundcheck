import { ScanForm } from '@/components/scan-form';

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
        <li>A plain-English explanation of every problem it finds.</li>
        <li>Scans your code and your live site.</li>
        <li>Rescan to see what&apos;s fixed.</li>
      </ul>
    </main>
  );
}
