/** A page on the site and the address parameters it takes, like `/search` and `q`. */
export interface Target {
  /** The page's address, without its query. */
  url: string;
  params: string[];
}

// Keep the scan gentle: a handful of pages and parameters is enough to spot the pattern.
const MAX_TARGETS = 6;
const MAX_PARAMS = 3;
// Parameters search and filter pages commonly use. Tried on the home page, since many sites
// answer any page with them.
const COMMON_PARAMS = ['q', 'search'];

const LINK = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+\?[^"'#]+)["']/gi;
const FORM = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
const INPUT_NAME =
  /<(?:input|select|textarea)\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi;

function sameSite(url: URL, home: URL): boolean {
  return url.hostname === home.hostname;
}

/**
 * Pages to try, from the home page's own links and search forms. Only pages on the same
 * site, only GET forms (a POST form could change data), and never a sign-out link.
 */
export function findTargets(html: string, homeUrl: string): Target[] {
  const home = new URL(homeUrl);
  const byPage = new Map<string, Set<string>>();
  const add = (url: URL, params: Iterable<string>) => {
    if (
      !sameSite(url, home) ||
      /log-?out|sign-?out|delete|remove/i.test(url.pathname)
    )
      return;
    const page = `${url.origin}${url.pathname}`;
    const known = byPage.get(page) ?? new Set<string>();
    for (const param of params)
      if (/^[\w.-]{1,40}$/.test(param)) known.add(param);
    if (known.size > 0) byPage.set(page, known);
  };

  add(home, COMMON_PARAMS);
  for (const [, href = ''] of html.matchAll(LINK)) {
    try {
      const url = new URL(href.replace(/&amp;/g, '&'), home);
      add(url, url.searchParams.keys());
    } catch {
      // A broken link tells us nothing.
    }
  }
  for (const [, attributes = '', inner = ''] of html.matchAll(FORM)) {
    if (/\bmethod\s*=\s*["']?post/i.test(attributes)) continue;
    const action =
      /\baction\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1] ?? '';
    try {
      const url = new URL(action || home.pathname, home);
      add(
        url,
        [...inner.matchAll(INPUT_NAME)].map(([, name = '']) => name),
      );
    } catch {
      // Same as above.
    }
  }

  return [...byPage].slice(0, MAX_TARGETS).map(([url, params]) => ({
    url,
    params: [...params].slice(0, MAX_PARAMS),
  }));
}

/** The page with one parameter set to `value`, as a browser would send it. */
export function withParam(
  target: Target,
  param: string,
  value: string,
): string {
  const url = new URL(target.url);
  url.searchParams.set(param, value);
  return url.href;
}
