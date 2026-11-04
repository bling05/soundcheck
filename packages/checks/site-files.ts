import type {
  GuardedFetch,
  GuardedFetchResult,
  GuardFailureReason,
} from './request-guard';

// A browser downloads all of these on every visit, so reading them adds about one visitor's
// traffic. Real apps split their code across many files: at 10, a real Supabase app was missed.
const MAX_FILES = 50;
// Stop reading early so a slow or enormous site can't tie up the worker.
const MAX_TOTAL_MS = 30_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

type ResponseHeaders = Extract<GuardedFetchResult, { ok: true }>['headers'];

export interface SiteFile {
  /** Where the file came from, without any query string. */
  location: string;
  text: string;
}

export type SiteRead =
  | {
      ok: true;
      /** The home page's status. An error here means `files` isn't the real site. */
      status: number;
      url: string;
      headers: ResponseHeaders;
      /** The home page first, then its code files. Hold these only as long as a check runs. */
      files: SiteFile[];
      /** False if part of the site couldn't be read, so nothing found doesn't mean nothing there. */
      complete: boolean;
      filesRead: number;
      filesNotRead: number;
      /** Code files on other sites. Left unread: a chat widget's code says nothing about this site. */
      filesFromOtherSites: number;
    }
  | { ok: false; reason: GuardFailureReason; message: string };

const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi;
const MODULE_PRELOAD =
  /<link\b[^>]*\brel\s*=\s*["']?modulepreload["']?[^>]*\bhref\s*=\s*["']?([^"'\s>]+)/gi;

/** Finds the code files a page loads, as full URLs, in page order without repeats. */
export function findCodeFiles(html: string, pageUrl: string): string[] {
  const found = new Set<string>();
  for (const pattern of [SCRIPT_SRC, MODULE_PRELOAD]) {
    for (const [, path] of html.matchAll(pattern)) {
      try {
        found.add(new URL(path ?? '', pageUrl).href);
      } catch {
        // A broken address in the page tells us nothing.
      }
    }
  }
  return [...found];
}

export function withoutQuery(url: string): string {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname}`;
}

/** True if a body came back compressed despite our request, so searching it would find nothing. */
function isCompressed(headers: ResponseHeaders): boolean {
  const encoding = headers['content-encoding'];
  return encoding !== undefined && encoding.toLowerCase() !== 'identity';
}

/** Reads a site's home page and up to 50 of its own code files, one at a time. */
export async function readSite(
  url: string,
  visit: GuardedFetch,
): Promise<SiteRead> {
  const home = await visit(url);
  if (!home.ok) return home;

  const hostname = new URL(home.url).hostname;
  const homeReadable = !home.truncated && !isCompressed(home.headers);
  const html = isCompressed(home.headers) ? '' : home.body.toString();

  const files: SiteFile[] = [{ location: withoutQuery(home.url), text: html }];
  const codeFiles = findCodeFiles(html, home.url);
  const ownFiles = codeFiles.filter(
    (file) => new URL(file).hostname === hostname,
  );

  let filesRead = 0;
  let filesNotRead = Math.max(ownFiles.length - MAX_FILES, 0);
  let bytesRead = home.body.length;
  const deadline = Date.now() + MAX_TOTAL_MS;
  for (const file of ownFiles.slice(0, MAX_FILES)) {
    if (Date.now() > deadline || bytesRead > MAX_TOTAL_BYTES) {
      filesNotRead++;
      continue;
    }
    const response = await visit(file);
    if (
      response.ok &&
      response.status < 400 &&
      !response.truncated &&
      !isCompressed(response.headers)
    ) {
      filesRead++;
      bytesRead += response.body.length;
      files.push({
        location: withoutQuery(response.url),
        text: response.body.toString(),
      });
    } else {
      filesNotRead++;
    }
  }

  return {
    ok: true,
    status: home.status,
    url: home.url,
    headers: home.headers,
    files,
    complete: home.status < 400 && homeReadable && filesNotRead === 0,
    filesRead,
    filesNotRead,
    filesFromOtherSites: codeFiles.length - ownFiles.length,
  };
}
