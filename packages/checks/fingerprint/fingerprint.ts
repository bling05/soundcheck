import type { AiTool, Platform } from '@soundcheck/shared';
import type {
  GuardedFetch,
  GuardedFetchResult,
  GuardFailureReason,
} from '../request-guard';
import { CLUES, type Clue, type Technology } from './clues';

// A browser downloads all of these on every visit, so reading them adds about one visitor's
// traffic. Real apps split their code across many files: at 10, a real Supabase app was missed.
const MAX_FILES = 50;
// Stop reading early so a slow or enormous site can't tie up the worker.
const MAX_TOTAL_MS = 30_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

type ResponseHeaders = Extract<GuardedFetchResult, { ok: true }>['headers'];

const PLATFORMS: Partial<Record<Technology, Platform>> = {
  supabase: 'supabase',
  firebase: 'firebase',
};
const TOOLS: Partial<Record<Technology, AiTool>> = {
  lovable: 'lovable',
  bolt: 'bolt',
};

export interface Detection {
  technology: Technology;
  description: string;
  /** Where the clue was found, without any query string. */
  foundAt: string;
}

export type FingerprintResult =
  | {
      ok: true;
      detections: Detection[];
      platforms: Platform[];
      tool?: AiTool;
      /**
       * False if part of the site couldn't be read. Either way, a missing technology
       * only means no clue was found. It never proves the site doesn't use it.
       */
      complete: boolean;
      filesRead: number;
      filesNotRead: number;
      /** Code files on other sites. Left unread: a chat widget's code says nothing about this site. */
      filesFromOtherSites: number;
    }
  | { ok: false; reason: GuardFailureReason; message: string };

interface Source {
  searchIn: Clue['searchIn'];
  text: string;
  location: string;
}

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
        // A broken address in the page isn't a clue about anything.
      }
    }
  }
  return [...found];
}

function headersAsText(headers: ResponseHeaders): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${[value].flat().join(', ')}`)
    .join('\n');
}

function withoutQuery(url: string): string {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname}`;
}

/** True if a body came back compressed despite our request, so searching it would find nothing. */
function isCompressed(headers: ResponseHeaders): boolean {
  const encoding = headers['content-encoding'];
  return encoding !== undefined && encoding.toLowerCase() !== 'identity';
}

/** Applies every clue to what was collected. One detection per technology, in table order. */
export function detect(sources: readonly Source[]): Detection[] {
  const detections = new Map<Technology, Detection>();
  for (const { technology, description, searchIn, pattern } of CLUES) {
    if (detections.has(technology)) continue;
    const source = sources.find(
      (candidate) =>
        candidate.searchIn === searchIn && pattern.test(candidate.text),
    );
    if (source) {
      detections.set(technology, {
        technology,
        description,
        foundAt: source.location,
      });
    }
  }
  return [...detections.values()];
}

function pick<T>(
  detections: readonly Detection[],
  table: Partial<Record<Technology, T>>,
): T[] {
  return detections.flatMap(({ technology }) => table[technology] ?? []);
}

/**
 * Works out what a site was built with from what it publicly sends. Downloads only the
 * home page and up to 50 of its own code files, and keeps none of their contents.
 */
export async function fingerprintSite(
  url: string,
  visit: GuardedFetch,
): Promise<FingerprintResult> {
  const home = await visit(url);
  if (!home.ok) return home;

  const location = withoutQuery(home.url);
  const hostname = new URL(home.url).hostname;
  const homeReadable = !home.truncated && !isCompressed(home.headers);
  const html = isCompressed(home.headers) ? '' : home.body.toString();

  const sources: Source[] = [
    { searchIn: 'host', text: hostname, location },
    { searchIn: 'headers', text: headersAsText(home.headers), location },
    { searchIn: 'content', text: html, location },
  ];

  const codeFiles = findCodeFiles(html, home.url);
  const ownFiles = codeFiles.filter(
    (file) => new URL(file).hostname === hostname,
  );

  let filesRead = 0;
  let filesNotRead = Math.max(ownFiles.length - MAX_FILES, 0);
  let bytesRead = home.body.length;
  const deadline = Date.now() + MAX_TOTAL_MS;
  // One at a time, to keep the load on the site gentle.
  for (const file of ownFiles.slice(0, MAX_FILES)) {
    if (Date.now() > deadline || bytesRead > MAX_TOTAL_BYTES) {
      filesNotRead++;
      continue;
    }
    const response = await visit(file);
    const readable =
      response.ok &&
      response.status < 400 &&
      !response.truncated &&
      !isCompressed(response.headers);
    if (response.ok && readable) {
      filesRead++;
      bytesRead += response.body.length;
      sources.push({
        searchIn: 'content',
        text: response.body.toString(),
        location: withoutQuery(response.url),
      });
    } else {
      filesNotRead++;
    }
  }

  const detections = detect(sources);
  return {
    ok: true,
    detections,
    platforms: pick(detections, PLATFORMS),
    tool: pick(detections, TOOLS)[0],
    complete: home.status < 400 && homeReadable && filesNotRead === 0,
    filesRead,
    filesNotRead,
    filesFromOtherSites: codeFiles.length - ownFiles.length,
  };
}
