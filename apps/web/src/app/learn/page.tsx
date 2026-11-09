import type { Metadata } from 'next';
import Link from 'next/link';
import { LearnSidebar } from '@/components/learn-sidebar';
import { CHAPTERS } from '@/lib/learn';

export const metadata: Metadata = {
  title: 'Learn | Soundcheck',
  description:
    'Plain-language notes on the security problems Soundcheck looks for, why AI tools make them, and how they get exploited.',
};

export default function LearnPage() {
  return (
    <>
      <LearnSidebar />
      <main className="notebook">
        <h1>Learn</h1>
        <p>
          Notes on every problem Soundcheck looks for: what it is, why AI tools
          make it, and how people take advantage of it. No security background
          needed. Pick a check to start.
        </p>
        <ul className="learn-checks">
          {CHAPTERS.map(({ number, slug, title }) => (
            <li key={slug}>
              <span className="handwritten">Check {number}:</span>{' '}
              <Link href={`/learn/${slug}`}>{title}</Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
