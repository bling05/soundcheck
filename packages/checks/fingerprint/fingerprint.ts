import type { AiTool, Platform } from '@soundcheck/shared';
import type { GuardedFetch, GuardFailureReason } from '../request-guard';
import { readSite, withoutQuery } from '../site-files';
import { CLUES, type Clue, type Technology } from './clues';

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

function headersAsText(
  headers: Record<string, string | string[] | undefined>,
): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${[value].flat().join(', ')}`)
    .join('\n');
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
  const site = await readSite(url, visit);
  if (!site.ok) return site;

  const location = withoutQuery(site.url);
  const sources: Source[] = [
    { searchIn: 'host', text: new URL(site.url).hostname, location },
    { searchIn: 'headers', text: headersAsText(site.headers), location },
    ...site.files.map((file): Source => ({
      searchIn: 'content',
      text: file.text,
      location: file.location,
    })),
  ];

  const detections = detect(sources);
  return {
    ok: true,
    detections,
    platforms: pick(detections, PLATFORMS),
    tool: pick(detections, TOOLS)[0],
    complete: site.complete,
    filesRead: site.filesRead,
    filesNotRead: site.filesNotRead,
    filesFromOtherSites: site.filesFromOtherSites,
  };
}
