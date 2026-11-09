import { LESSONS } from '@soundcheck/report';
import { describe, expect, it } from 'vitest';
import { chapterPage, CHAPTERS, findChapter, learnHref } from './learn';

const pageFor = (slug: string) => {
  const chapter = findChapter(slug);
  if (!chapter) throw new Error(`no check called ${slug}`);
  return chapterPage(chapter);
};

describe('the Learn section', () => {
  it('covers every explanation, once', () => {
    const ids = CHAPTERS.flatMap(({ topics }) => topics.map(({ id }) => id));
    expect([...ids].sort()).toEqual(Object.keys(LESSONS).sort());
  });

  it('gives every check its own address, and every topic its own section', () => {
    const slugs = CHAPTERS.map(({ slug }) => slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const chapter of CHAPTERS) {
      const anchors = chapterPage(chapter).groups.flatMap(({ topics }) =>
        topics.map(({ anchor }) => anchor),
      );
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });

  it("links a finding to its check's page, at its section", () => {
    expect(learnHref('bundle-secrets:stripe-secret')).toBe(
      '/learn/secret-keys#stripe-secret',
    );
    expect(findChapter('secret-keys')?.number).toBe(2);
    expect(findChapter('nothing')).toBeUndefined();
  });

  it('shows text most topics share once, and past cases once each', () => {
    const page = pageFor('secret-keys');
    const [group] = page.groups;
    expect(page.groups).toHaveLength(1);
    expect(group?.platform).toBeUndefined();
    expect(group?.shared.whyAiToolsProduceIt).toBeDefined();
    // Six key types share the same "why", so only the two different ones keep their own.
    expect(
      group?.topics.filter((topic) => topic.whyAiToolsProduceIt).length,
    ).toBe(2);
    // Only two AI-key topics share the same risks, so each topic keeps its own.
    expect(group?.shared.howItIsExploited).toBeUndefined();
    const urls = page.pastCases.map(({ url }) => url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("splits Supabase and Firebase, and never puts one platform's text over the other", () => {
    const { groups } = pageFor('databases');
    expect(
      groups.map(({ platform, topics }) => [platform, topics.length]),
    ).toEqual([
      ['Supabase', 1],
      ['Firebase', 3],
    ]);
    const [supabase, firebase] = groups;
    expect(supabase?.shared).toEqual({});
    expect(firebase?.shared.whyAiToolsProduceIt).toContain('test mode');
  });
});
