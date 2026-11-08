import { createHash, randomBytes } from 'node:crypto';
import type { GuardedFetch } from './request-guard';

/**
 * Domain verification: proving you own a site before Soundcheck sends requests to its
 * database. Like Google Search Console, the owner puts a code on their site.
 *
 * The owner's browser keeps a random secret. The code on the site is a one-way hash of that
 * secret and the hostname, so anyone can read the code but nobody can work out the secret
 * from it. Only the browser holding the secret can unlock checks for that site.
 */

export const VERIFICATION_META_NAME = 'soundcheck-verification';
export const VERIFICATION_FILE_PATH =
  '/.well-known/soundcheck-verification.txt';

/** A new secret for one browser. It covers every site that browser verifies. */
export function createVerificationSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** The code the owner puts on their site. Different for every site, from the same secret. */
export function verificationCode(secret: string, hostname: string): string {
  const hash = createHash('sha256')
    .update(`${hostname.toLowerCase()}\n${secret}`)
    .digest('base64url');
  return `sc-${hash}`;
}

const META_TAG = /<meta\b[^>]*>/gi;
const ATTRIBUTE = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');

function attribute(tag: string, name: string): string | undefined {
  const match = ATTRIBUTE(name).exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/** True if a page has `<meta name="soundcheck-verification" content="<code>">`. */
export function pageHasCode(html: string, code: string): boolean {
  for (const [tag] of html.matchAll(META_TAG)) {
    if (
      attribute(tag, 'name')?.toLowerCase() === VERIFICATION_META_NAME &&
      attribute(tag, 'content')?.trim() === code
    ) {
      return true;
    }
  }
  return false;
}

/** True if the verification file holds exactly the code, ignoring surrounding whitespace. */
export function fileHasCode(text: string, code: string): boolean {
  return text.trim() === code;
}

export type VerificationResult =
  | { verified: true; method: 'meta-tag' | 'file' }
  | { verified: false; reason: 'not-found' | 'unreachable'; message: string };

/**
 * Looks for the code on the page at `url` and in the verification file at the site's root.
 * Either one is enough. Only reads public pages, through the request guard.
 */
export async function checkVerification(
  url: string,
  code: string,
  fetch: GuardedFetch,
): Promise<VerificationResult> {
  const page = await fetch(url);
  if (!page.ok) {
    return { verified: false, reason: 'unreachable', message: page.message };
  }
  const hostname = new URL(url).hostname;
  // A redirect to another site doesn't count: the code has to be on this site.
  const onSite = (finalUrl: string) => new URL(finalUrl).hostname === hostname;

  if (
    page.status < 400 &&
    onSite(page.url) &&
    pageHasCode(page.body.toString(), code)
  ) {
    return { verified: true, method: 'meta-tag' };
  }

  const file = await fetch(new URL(VERIFICATION_FILE_PATH, url).href, {
    maxBytes: 1024,
  });
  if (
    file.ok &&
    file.status < 300 &&
    onSite(file.url) &&
    fileHasCode(file.body.toString(), code)
  ) {
    return { verified: true, method: 'file' };
  }

  return {
    verified: false,
    reason: 'not-found',
    message: `We couldn't find your code on ${hostname}. Check that the change is live, then try again.`,
  };
}
