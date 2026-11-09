import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LearnSidebar } from '@/components/learn-sidebar';
import {
  chapterPage,
  CHAPTERS,
  findChapter,
  type TopicGroup,
  type TopicSection,
} from '@/lib/learn';

interface Props {
  params: Promise<{ check: string }>;
}

function contentsLink({ anchor, title }: TopicSection) {
  return (
    <li key={anchor}>
      <a href={`#${anchor}`}>{title}</a>
    </li>
  );
}

/** Causes and risks most of a group's topics share, shown once at the top of the group. */
function SharedParts({
  shared,
  level,
}: {
  shared: TopicGroup['shared'];
  level: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <>
      {shared.whyAiToolsProduceIt && (
        <>
          <Heading>Causes</Heading>
          <p>{shared.whyAiToolsProduceIt}</p>
        </>
      )}
      {shared.howItIsExploited && (
        <>
          <Heading>Risks</Heading>
          <p>{shared.howItIsExploited}</p>
        </>
      )}
    </>
  );
}

/** One problem. Under a platform heading it sits one heading level lower. */
function TopicBlock({ topic, level }: { topic: TopicSection; level: 2 | 3 }) {
  const Title = level === 2 ? 'h2' : 'h3';
  const Part = level === 2 ? 'h3' : 'h4';
  return (
    <section id={topic.anchor} className="topic">
      <Title>{topic.title}</Title>
      <p>{topic.whatItIs}</p>
      {topic.whyAiToolsProduceIt && (
        <>
          <Part>Causes</Part>
          <p>{topic.whyAiToolsProduceIt}</p>
        </>
      )}
      {topic.howItIsExploited && (
        <>
          <Part>Risks</Part>
          <p>{topic.howItIsExploited}</p>
        </>
      )}
    </section>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const chapter = findChapter((await params).check);
  return chapter
    ? {
        title: `${chapter.title} | Learn | Soundcheck`,
        description: `${chapter.about ?? chapter.title}: what Soundcheck's check #${chapter.number} looks for, why AI tools make these mistakes, and how they get exploited.`,
      }
    : {};
}

export default async function CheckPage({ params }: Props) {
  const chapter = findChapter((await params).check);
  if (!chapter) notFound();
  const { groups, pastCases, filedUnder } = chapterPage(chapter);
  const topicCount = groups.flatMap(({ topics }) => topics).length;
  const next = CHAPTERS[CHAPTERS.indexOf(chapter) + 1];

  return (
    <>
      <LearnSidebar active={chapter.slug} />
      <main className="notebook">
        <p className="handwritten">Check {chapter.number}</p>
        <h1>{chapter.title}</h1>
        {chapter.about && <p className="learn-about">{chapter.about}</p>}

        {topicCount > 1 && (
          <ul className="on-this-page" aria-label="On this page">
            {groups.map(({ platform, topics: grouped }) =>
              platform ? (
                <li key={platform}>
                  {platform}
                  <ul>{grouped.map(contentsLink)}</ul>
                </li>
              ) : (
                grouped.map(contentsLink)
              ),
            )}
          </ul>
        )}

        {groups.map(({ platform, shared, topics: grouped }) =>
          platform ? (
            <section key={platform} className="platform">
              <h2>{platform}</h2>
              <SharedParts shared={shared} level={3} />
              {grouped.map((topic) => (
                <TopicBlock key={topic.anchor} topic={topic} level={3} />
              ))}
            </section>
          ) : (
            <div key="all">
              <SharedParts shared={shared} level={2} />
              {grouped.map((topic) => (
                <TopicBlock key={topic.anchor} topic={topic} level={2} />
              ))}
            </div>
          ),
        )}

        {pastCases.length > 0 && (
          <section className="past-cases">
            <h2>{pastCases.length === 1 ? 'Past case' : 'Past cases'}</h2>
            {pastCases.map(({ summary, source, url }) => (
              <aside className="past-case" key={url}>
                <p>{summary}</p>
                <p>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    Source: {source}
                  </a>
                </p>
              </aside>
            ))}
          </section>
        )}

        <p className="filed-under">Filed under {filedUnder.join(' · ')}</p>

        {next && (
          <p className="next-check">
            <Link href={`/learn/${next.slug}`}>
              Next: Check {next.number}, {next.title} →
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
