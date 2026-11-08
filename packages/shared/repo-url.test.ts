import { describe, expect, it } from 'vitest';
import { parseRepoUrl, repoLabel } from './repo-url';

describe('parseRepoUrl', () => {
  it.each([
    'github.com/bling05/soundcheck',
    'https://github.com/bling05/soundcheck',
    'https://github.com/bling05/soundcheck.git',
    'https://www.github.com/bling05/soundcheck/',
    'https://github.com/bling05/soundcheck/tree/main/packages',
    '  github.com/bling05/soundcheck  ',
  ])('reads %s', (input) => {
    expect(parseRepoUrl(input)).toEqual({
      ok: true,
      repo: { owner: 'bling05', name: 'soundcheck' },
    });
  });

  it.each([
    ['', "repo's link"],
    ['gitlab.com/a/b', 'Only GitHub'],
    ['github.com/bling05', 'repo itself'],
    ['github.com/-bad/repo', 'repo itself'],
    ['github.com/a/..', 'repo itself'],
    ['https://evil.example/github.com/a/b', 'Only GitHub'],
  ])('refuses %s', (input, message) => {
    expect(parseRepoUrl(input)).toMatchObject({
      ok: false,
      message: expect.stringContaining(message),
    });
  });

  it('labels a repo', () => {
    expect(repoLabel({ owner: 'a', name: 'b' })).toBe('github.com/a/b');
  });
});
