import { LESSONS, type LessonId, type RealCase } from '@soundcheck/report';

export type Platform = 'Supabase' | 'Firebase';

export interface Topic {
  id: LessonId;
  title: string;
  /** For checks that cover more than one platform, which one this is about. */
  platform?: Platform;
}

export interface Chapter {
  /** The check's number, as the docs and reports count them. */
  number: number;
  /** Its address, like `/learn/secret-keys`. */
  slug: string;
  title: string;
  /** A plain description, for a title that is a security term people may not know. */
  about?: string;
  topics: Topic[];
}

const topic = (id: LessonId, title: string, platform?: Platform): Topic => ({
  id,
  title,
  ...(platform && { platform }),
});

/** The Learn section: one page per check, with every problem that check looks for. */
export const CHAPTERS: readonly Chapter[] = [
  {
    number: 1,
    slug: 'security-headers',
    title: 'Security headers, cookies, clickjacking',
    topics: [
      topic(
        'security-headers:content-security-policy',
        'No Content Security Policy',
      ),
      topic('security-headers:strict-transport-security', 'No HTTPS-only rule'),
      topic('security-headers:frame-protection', 'Other sites can frame yours'),
      topic('security-headers:content-type-options', 'File type sniffing'),
      topic('security-headers:cors-any-site', 'Any site can read your API'),
      topic(
        'security-headers:cookie-not-secure',
        'Login cookies sent without HTTPS',
      ),
      topic(
        'security-headers:cookie-not-httponly',
        'Login cookies scripts can read',
      ),
    ],
  },
  {
    number: 2,
    slug: 'secret-keys',
    title: 'Secret keys in public code',
    topics: [
      topic('bundle-secrets:supabase-secret', 'Supabase secret keys'),
      topic('bundle-secrets:stripe-secret', 'Stripe secret keys'),
      topic('bundle-secrets:private-key', 'Private keys'),
      topic('bundle-secrets:openai-key', 'OpenAI keys'),
      topic('bundle-secrets:anthropic-key', 'Anthropic keys'),
      topic('bundle-secrets:aws-key', 'AWS keys'),
      topic('bundle-secrets:google-api-key', 'Google API keys and Gemini'),
      topic(
        'bundle-secrets:browser-ai-call',
        'AI services called from the browser',
      ),
    ],
  },
  {
    number: 3,
    slug: 'leftover-files',
    title: 'Leftover files',
    topics: [
      topic('leftover-files:env-file', '.env files'),
      topic('leftover-files:git-folder', 'A public .git folder'),
      topic('leftover-files:database-dump', 'Database backups'),
      topic('leftover-files:site-archive', 'Site archives'),
      topic('leftover-files:debug-page', 'Debug pages'),
      topic('leftover-files:api-docs', 'Public API docs'),
      topic('leftover-files:source-map', 'Source maps'),
    ],
  },
  {
    number: 4,
    slug: 'databases',
    title: 'Databases anyone can read',
    topics: [
      topic(
        'supabase-rls:readable-table',
        'Tables anyone can read',
        'Supabase',
      ),
      topic(
        'firebase-rules:firestore-open',
        'Firestore in test mode',
        'Firebase',
      ),
      topic(
        'firebase-rules:readable-collection',
        'Firestore collections anyone can read',
        'Firebase',
      ),
      topic(
        'firebase-rules:realtime-open',
        'Realtime Database open to everyone',
        'Firebase',
      ),
    ],
  },
  {
    number: 5,
    slug: 'file-storage',
    title: 'Leaky buckets',
    about: 'File storage anyone can list',
    topics: [
      topic(
        'supabase-storage:listable-bucket',
        'Storage buckets anyone can list',
        'Supabase',
      ),
      topic(
        'firebase-storage:listable',
        'Cloud Storage anyone can list',
        'Firebase',
      ),
    ],
  },
  {
    number: 6,
    slug: 'nextjs-version',
    title: 'Outdated Next.js',
    topics: [
      topic('nextjs-version:outdated', 'Next.js versions with known holes'),
    ],
  },
  {
    number: 7,
    slug: 'supabase-policies',
    title: 'Supabase policy mistakes',
    topics: [
      topic('supabase-policies:rls-off', 'RLS turned off'),
      topic('supabase-policies:everyone-can-read', 'Everyone can read'),
      topic(
        'supabase-policies:any-user-can-read',
        'Any signed-in user can read everything',
      ),
      topic('supabase-policies:write-as-anyone', 'Anyone can write'),
      topic(
        'supabase-policies:trusts-user-metadata',
        'Roles taken from user_metadata',
      ),
    ],
  },
  {
    number: 8,
    slug: 'ownership-checks',
    title: 'Ownership checks (IDOR)',
    topics: [
      topic(
        'ownership-checks:missing-owner-check',
        'Changing the id in a request (IDOR)',
      ),
    ],
  },
  {
    number: 9,
    slug: 'committed-secrets',
    title: 'Secret sprawl',
    about: 'Secrets committed to your repo',
    topics: [
      topic('repo-secrets:supabase-secret', 'Supabase secret keys'),
      topic('repo-secrets:stripe-secret', 'Stripe secret keys'),
      topic('repo-secrets:private-key', 'Private keys'),
      topic('repo-secrets:openai-key', 'OpenAI keys'),
      topic('repo-secrets:anthropic-key', 'Anthropic keys'),
      topic('repo-secrets:aws-key', 'AWS keys'),
      topic('repo-secrets:database-url', 'Database passwords'),
      topic('repo-secrets:env-file', 'Committed .env files'),
      topic('repo-secrets:env-not-ignored', 'A .gitignore that misses .env'),
    ],
  },
  {
    number: 10,
    slug: 'made-up-packages',
    title: 'Fake packages (Slopsquatting)',
    about: 'Made-up names, known malware, and lookalikes',
    topics: [
      topic('slopsquatting:missing-package', "Packages that don't exist"),
      topic('slopsquatting:malware-package', 'Known malware'),
      topic('slopsquatting:new-package', 'Brand-new, barely used packages'),
      topic('slopsquatting:lookalike-package', 'Lookalike names'),
    ],
  },
];

/** `bundle-secrets:stripe-secret` becomes the `stripe-secret` section of its check's page. */
function anchorFor(id: LessonId): string {
  return id.slice(id.indexOf(':') + 1);
}

/** Where a finding's "Learn more" goes: its check's page, at its section. */
export function learnHref(id: LessonId): string {
  const chapter = CHAPTERS.find(({ topics }) =>
    topics.some((topic) => topic.id === id),
  );
  return chapter ? `/learn/${chapter.slug}#${anchorFor(id)}` : '/learn';
}

export function findChapter(slug: string): Chapter | undefined {
  return CHAPTERS.find((chapter) => chapter.slug === slug);
}

export interface TopicSection {
  anchor: string;
  title: string;
  whatItIs: string;
  /** Only when this topic's text differs from the rest of its group's. */
  whyAiToolsProduceIt?: string;
  howItIsExploited?: string;
}

export interface TopicGroup {
  /** Missing for a check that covers every platform the same way. */
  platform?: Platform;
  /** Text most of the group's topics share, shown once instead of in each. */
  shared: { whyAiToolsProduceIt?: string; howItIsExploited?: string };
  topics: TopicSection[];
}

export interface ChapterPage {
  /** One group per platform, in order, or a single group for a check that covers all. */
  groups: TopicGroup[];
  /** Each past case once, even when several topics cite it. */
  pastCases: RealCase[];
  filedUnder: string[];
}

/**
 * The value most of the topics use, if any, so it can be shown once. Text only a few
 * topics share stays with those topics.
 */
function sharedValue(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const [value, count] of counts) {
    if (count >= 2 && count > values.length / 2) return value;
  }
  return undefined;
}

/** Splits topics by platform, keeping their order. */
function byPlatform(topics: readonly Topic[]): Topic[][] {
  const groups: Topic[][] = [];
  for (const topic of topics) {
    const last = groups.at(-1);
    if (last && last[0]?.platform === topic.platform) last.push(topic);
    else groups.push([topic]);
  }
  return groups;
}

/** A platform's topics, with the text most of them share pulled out once. */
function topicGroup(topics: readonly Topic[]): TopicGroup {
  const lessons = topics.map(({ id }) => LESSONS[id]);
  const why = sharedValue(lessons.map((lesson) => lesson.whyAiToolsProduceIt));
  const how = sharedValue(lessons.map((lesson) => lesson.howItIsExploited));
  const platform = topics[0]?.platform;
  return {
    ...(platform && { platform }),
    shared: {
      ...(why && { whyAiToolsProduceIt: why }),
      ...(how && { howItIsExploited: how }),
    },
    topics: topics.map(({ id, title }) => {
      const lesson = LESSONS[id];
      return {
        anchor: anchorFor(id),
        title,
        whatItIs: lesson.whatItIs,
        ...(lesson.whyAiToolsProduceIt !== why && {
          whyAiToolsProduceIt: lesson.whyAiToolsProduceIt,
        }),
        ...(lesson.howItIsExploited !== how && {
          howItIsExploited: lesson.howItIsExploited,
        }),
      };
    }),
  };
}

/**
 * Everything one check's page shows. Checks that cover Supabase and Firebase get a part
 * for each, and repeated text is gathered once per part, so one platform's explanation
 * never sits over the other's.
 */
export function chapterPage(chapter: Chapter): ChapterPage {
  const lessons = chapter.topics.map(({ id }) => LESSONS[id]);
  const pastCases = new Map<string, RealCase>();
  for (const lesson of lessons) {
    if ('realCase' in lesson && lesson.realCase)
      pastCases.set(lesson.realCase.url, lesson.realCase);
  }
  return {
    groups: byPlatform(chapter.topics).map(topicGroup),
    pastCases: [...pastCases.values()],
    filedUnder: [
      ...new Set(lessons.flatMap((lesson) => [...lesson.owasp, ...lesson.cwe])),
    ],
  };
}
