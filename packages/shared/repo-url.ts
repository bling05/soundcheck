export interface RepoRef {
  owner: string;
  name: string;
}

export type RepoUrlResult =
  { ok: true; repo: RepoRef } | { ok: false; message: string };

// GitHub's own limits: owners are letters, numbers, and single hyphens; repo names also
// allow dots and underscores.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Turns what someone typed into a GitHub repo, or says what's wrong in words they can act
 * on. Accepts `github.com/owner/repo` with or without https, `.git`, or a path after it,
 * like a link to one folder. Only public GitHub repos can be scanned for now.
 */
export function parseRepoUrl(input: string): RepoUrlResult {
  const text = input.trim();
  if (text === '') return { ok: false, message: "Enter your repo's link." };

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, message: "That doesn't look like a link." };
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return {
      ok: false,
      message:
        'Only GitHub repos can be scanned for now. Use a link like github.com/you/your-app.',
    };
  }

  const [owner = '', rawName = ''] = url.pathname.split('/').filter(Boolean);
  const name = rawName.replace(/\.git$/, '');
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') {
    return {
      ok: false,
      message: 'Use the link to the repo itself, like github.com/you/your-app.',
    };
  }
  return { ok: true, repo: { owner, name } };
}

/** How a repo is shown, like `github.com/you/your-app`. */
export function repoLabel({ owner, name }: RepoRef): string {
  return `github.com/${owner}/${name}`;
}
