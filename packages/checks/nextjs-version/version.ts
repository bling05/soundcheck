import { stringAssignedBefore, VARIABLE } from '../code-names';
import type { SiteFile } from '../site-files';
import { ADVISORIES, type Advisory } from './advisories';

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
// Next.js's browser code announces itself: `window.next={version:"16.4.4",appDir:!0}`.
// Older builds keep the version in a variable first: `window.next={version:r,...}`.
const WINDOW_NEXT = new RegExp(
  `window\\.next\\s*=\\s*\\{\\s*version\\s*:\\s*(?:["'\`]([^"'\`]{1,40})["'\`]|(${VARIABLE}))([^}]{0,200})\\}`,
);

export interface NextVersion {
  version: string;
  /** True when the code says the site uses the App Router. */
  appRouter: boolean;
  /** The code file the version was read from. */
  location: string;
}

/** Reads the Next.js version the site's own browser code reports. */
export function findNextVersion(
  files: readonly SiteFile[],
): NextVersion | undefined {
  for (const { location, text } of files) {
    const match = WINDOW_NEXT.exec(text);
    if (!match) continue;
    const version =
      match[1] ??
      (match[2] && stringAssignedBefore(text, match[2], match.index));
    if (version && VERSION.test(version)) {
      return {
        version,
        appRouter: /\bappDir\s*:\s*(?:!0|true)/.test(match[3] ?? ''),
        location,
      };
    }
  }
  return undefined;
}

/**
 * Compares two versions like `15.1.2`. A test version like `16.1.0-canary.5` comes before
 * `16.1.0`. Test versions are only compared by their number, so a few vulnerable ones are
 * missed; live sites rarely run them.
 */
export function compareVersions(a: string, b: string): number {
  const [, ...left] = VERSION.exec(a) ?? [];
  const [, ...right] = VERSION.exec(b) ?? [];
  for (let index = 0; index < 3; index++) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return difference;
  }
  if (left[3] && !right[3]) return -1;
  if (!left[3] && right[3]) return 1;
  return 0;
}

export interface Hit {
  advisory: Advisory;
  fixed: string;
}

/** The critical holes this version has, each with the version that fixes it. */
export function holesIn(version: string): Hit[] {
  return ADVISORIES.flatMap((advisory) => {
    const range = advisory.ranges.find(
      ({ from, fixed }) =>
        compareVersions(version, from) >= 0 &&
        compareVersions(version, fixed) < 0,
    );
    return range ? [{ advisory, fixed: range.fixed }] : [];
  });
}

/** The lowest version that fixes every hole found: the newest of the fixes. */
export function upgradeTarget(hits: readonly Hit[]): string | undefined {
  return hits
    .map(({ fixed }) => fixed)
    .sort(compareVersions)
    .at(-1);
}
