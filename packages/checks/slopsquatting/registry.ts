import type { GuardedFetch } from '../request-guard';
import type { Dependency } from './manifests';

export type PackageStatus =
  | { kind: 'missing' }
  /** npm took it down and left a placeholder, or OSV lists every version as malicious. */
  | { kind: 'malware'; by: 'npm' | 'osv'; advisory?: string }
  | {
      kind: 'new';
      daysOld: number;
      weeklyDownloads: number;
      /** It runs code by itself during install (npm only). */
      installScript: boolean;
    }
  /** One typo away from a popular package, and barely used itself. */
  | { kind: 'lookalike'; of: string; weeklyDownloads: number }
  | { kind: 'fine' }
  /** The registry didn't answer, so we can't say either way. */
  | { kind: 'unknown' };

export interface Lookup {
  status: PackageStatus;
  /**
   * Every version the registry has, when its entry was small enough to read. OSV uses it
   * to tell a package that's malware from one that only had a few bad versions.
   */
  versions?: string[];
}

/** Younger than this, and barely downloaded, is what a freshly squatted name looks like. */
export const NEW_PACKAGE_DAYS = 90;
export const FEW_WEEKLY_DOWNLOADS = 500;
/** Lookalikes can be older, so they get a higher bar before they're called barely used. */
export const FEW_LOOKALIKE_DOWNLOADS = 1000;
// Established packages have long histories, so their registry entries are big. Anything
// that doesn't fit in this is old enough not to be new.
const MAX_ENTRY_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

export interface RegistryBases {
  npm: string;
  npmDownloads: string;
  pypi: string;
  pypiStats: string;
  osv: string;
}

export const REGISTRIES: RegistryBases = {
  npm: 'https://registry.npmjs.org',
  npmDownloads: 'https://api.npmjs.org/downloads/point/last-week',
  pypi: 'https://pypi.org/pypi',
  pypiStats: 'https://pypistats.org/api/packages',
  osv: 'https://api.osv.dev',
};

export function parse(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function daysSince(date: string | undefined, now: number): number | undefined {
  const time = date ? Date.parse(date) : NaN;
  return Number.isNaN(time) ? undefined : Math.floor((now - time) / DAY_MS);
}

async function weeklyDownloads(
  fetch: GuardedFetch,
  url: string,
  read: (json: Record<string, unknown> | undefined) => unknown,
): Promise<number> {
  const response = await fetch(url, { timeoutMs: TIMEOUT_MS });
  // Brand-new packages often have no download stats yet, which counts as none.
  if (!response.ok || response.status !== 200) return 0;
  const count = read(record(parse(response.body)));
  return typeof count === 'number' ? count : 0;
}

interface Entry {
  daysOld: number | undefined;
  versions: string[];
  installScript: boolean;
}

/** New and barely used, a lookalike that's barely used, or fine. */
async function judge(
  entry: Entry,
  lookalikeOf: string | undefined,
  downloads: () => Promise<number>,
): Promise<Lookup> {
  const { daysOld, versions, installScript } = entry;
  const isNew = daysOld !== undefined && daysOld < NEW_PACKAGE_DAYS;
  if (!isNew && !lookalikeOf) return { status: { kind: 'fine' }, versions };
  const weekly = await downloads();
  if (isNew && weekly < FEW_WEEKLY_DOWNLOADS) {
    return {
      status: { kind: 'new', daysOld, weeklyDownloads: weekly, installScript },
      versions,
    };
  }
  if (lookalikeOf && weekly < FEW_LOOKALIKE_DOWNLOADS) {
    return {
      status: { kind: 'lookalike', of: lookalikeOf, weeklyDownloads: weekly },
      versions,
    };
  }
  return { status: { kind: 'fine' }, versions };
}

async function npmLookup(
  { name }: Dependency,
  lookalikeOf: string | undefined,
  fetch: GuardedFetch,
  bases: RegistryBases,
  now: number,
): Promise<Lookup> {
  // Scoped names keep their @ but encode the slash, like `@types%2fnode`.
  const response = await fetch(`${bases.npm}/${name.replace('/', '%2f')}`, {
    maxBytes: MAX_ENTRY_BYTES,
    timeoutMs: TIMEOUT_MS,
  });
  if (!response.ok) return { status: { kind: 'unknown' } };
  if (response.status === 404) return { status: { kind: 'missing' } };
  if (response.status !== 200) return { status: { kind: 'unknown' } };
  if (response.truncated) return { status: { kind: 'fine' } };
  const entry = record(parse(response.body));
  if (!entry) return { status: { kind: 'unknown' } };

  const latest = record(entry['dist-tags'])?.latest;
  if (typeof latest === 'string' && /-security$/.test(latest)) {
    return { status: { kind: 'malware', by: 'npm' } };
  }
  const time = record(entry.time);
  const versions = record(entry.versions);
  // Taken down by its author: the name exists but nothing installs.
  if (time?.unpublished && !versions) return { status: { kind: 'missing' } };

  // npm copies each version's package.json here, scripts included.
  const scripts =
    typeof latest === 'string'
      ? record(record(versions?.[latest])?.scripts)
      : undefined;
  return judge(
    {
      daysOld: daysSince(
        typeof time?.created === 'string' ? time.created : undefined,
        now,
      ),
      versions: Object.keys(versions ?? {}),
      installScript: INSTALL_SCRIPTS.some((script) => scripts?.[script]),
    },
    lookalikeOf,
    () =>
      weeklyDownloads(
        fetch,
        `${bases.npmDownloads}/${name}`,
        (json) => json?.downloads,
      ),
  );
}

/** The earliest upload of any release, which is when the name was first used. */
function firstUpload(releases: Record<string, unknown>): string | undefined {
  let earliest: string | undefined;
  for (const files of Object.values(releases)) {
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      const uploaded = record(file)?.upload_time_iso_8601;
      if (typeof uploaded === 'string' && (!earliest || uploaded < earliest))
        earliest = uploaded;
    }
  }
  return earliest;
}

async function pypiLookup(
  { name }: Dependency,
  lookalikeOf: string | undefined,
  fetch: GuardedFetch,
  bases: RegistryBases,
  now: number,
): Promise<Lookup> {
  const response = await fetch(`${bases.pypi}/${name}/json`, {
    maxBytes: MAX_ENTRY_BYTES,
    timeoutMs: TIMEOUT_MS,
  });
  if (!response.ok) return { status: { kind: 'unknown' } };
  // PyPI deletes malware outright, so removed and never-existed look the same here. OSV
  // can tell them apart.
  if (response.status === 404) return { status: { kind: 'missing' } };
  if (response.status !== 200) return { status: { kind: 'unknown' } };
  if (response.truncated) return { status: { kind: 'fine' } };
  const entry = record(parse(response.body));
  if (!entry) return { status: { kind: 'unknown' } };

  const releases = record(entry.releases) ?? {};
  return judge(
    {
      daysOld: daysSince(firstUpload(releases), now),
      versions: Object.keys(releases),
      // Python packages can run code on install too, but PyPI doesn't say which do.
      installScript: false,
    },
    lookalikeOf,
    () =>
      weeklyDownloads(
        fetch,
        `${bases.pypiStats}/${name}/recent`,
        (json) => record(json?.data)?.last_week,
      ),
  );
}

export function lookUp(
  dependency: Dependency,
  lookalikeOf: string | undefined,
  fetch: GuardedFetch,
  bases: RegistryBases = REGISTRIES,
  now = Date.now(),
): Promise<Lookup> {
  return dependency.ecosystem === 'npm'
    ? npmLookup(dependency, lookalikeOf, fetch, bases, now)
    : pypiLookup(dependency, lookalikeOf, fetch, bases, now);
}

export { inBatches } from '../in-batches';
