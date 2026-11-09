import Link from 'next/link';
import { CHAPTERS } from '@/lib/learn';

/** Every check, with the open one marked. */
export function LearnSidebar({ active }: { active?: string }) {
  return (
    <nav className="learn-sidebar" aria-label="Checks">
      <Link href="/" className="learn-sidebar-site">
        ← Soundcheck
      </Link>
      <Link
        href="/learn"
        className="learn-sidebar-home"
        aria-current={active === undefined ? 'page' : undefined}
      >
        Learn
      </Link>
      <ol>
        {CHAPTERS.map(({ number, slug, title }) => (
          <li key={slug}>
            <Link
              href={`/learn/${slug}`}
              aria-current={active === slug ? 'page' : undefined}
            >
              <span className="learn-sidebar-number">{number}</span>
              {title}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
