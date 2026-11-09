import type { GuardedFetch } from '../request-guard';
import type { Dependency } from './manifests';
import { inBatches } from '../in-batches';
import { parse, record, type RegistryBases } from './registry';

const BATCH_SIZE = 300;
// Only a handful of packages in a repo should ever have malware reports.
const MAX_ADVISORIES = 30;
const TIMEOUT_MS = 10_000;

const OSV_ECOSYSTEM = { npm: 'npm', pypi: 'PyPI' } as const;

export interface OsvResult {
  /** Advisory id for each dependency OSV lists as malware in every version. */
  malware: Map<Dependency, string>;
  /** False if OSV didn't answer, so the note can say so. */
  answered: boolean;
}

/** `MAL-` ids are OSV's malicious-package reports, from the OpenSSF malware feed. */
async function malwareIds(
  dependencies: readonly Dependency[],
  fetch: GuardedFetch,
  base: string,
): Promise<{ ids: Map<Dependency, string[]>; answered: boolean }> {
  const ids = new Map<Dependency, string[]>();
  let answered = true;
  for (let start = 0; start < dependencies.length; start += BATCH_SIZE) {
    const batch = dependencies.slice(start, start + BATCH_SIZE);
    const response = await fetch(`${base}/v1/querybatch`, {
      method: 'POST',
      json: {
        queries: batch.map(({ ecosystem, name }) => ({
          package: { name, ecosystem: OSV_ECOSYSTEM[ecosystem] },
        })),
      },
      timeoutMs: TIMEOUT_MS,
    });
    const results = response.ok
      ? record(parse(response.body))?.results
      : undefined;
    if (!Array.isArray(results)) {
      answered = false;
      continue;
    }
    for (const [index, result] of results.entries()) {
      const vulns = record(result)?.vulns;
      const dependency = batch[index];
      if (!dependency || !Array.isArray(vulns)) continue;
      const found = vulns.flatMap((vuln) => {
        const id = record(vuln)?.id;
        return typeof id === 'string' && id.startsWith('MAL-') ? [id] : [];
      });
      if (found.length > 0) ids.set(dependency, found);
    }
  }
  return { ids, answered };
}

/**
 * True if the report covers the whole package, not just a few hijacked versions, like
 * chalk 5.6.1 in 2025. Either a range from version 0 that's never fixed, or a list that
 * includes every version the registry has. When the registry has none, it's gone.
 */
export function coversWholePackage(
  advisory: unknown,
  versions: readonly string[] | undefined,
): boolean {
  const affected = record(advisory)?.affected;
  if (!Array.isArray(affected)) return false;
  return affected.some((entry) => {
    const ranges = record(entry)?.ranges;
    const fromZero =
      Array.isArray(ranges) &&
      ranges.some((range) => {
        const events = record(range)?.events;
        return (
          Array.isArray(events) &&
          events.some((event) => record(event)?.introduced === '0') &&
          !events.some(
            (event) => record(event)?.fixed || record(event)?.last_affected,
          )
        );
      });
    if (fromZero) return true;
    const listed = record(entry)?.versions;
    if (!Array.isArray(listed) || versions === undefined) return false;
    return versions.every((version) => listed.includes(version));
  });
}

/** Asks OSV which of these packages are known malware in every version. */
export async function findKnownMalware(
  dependencies: readonly Dependency[],
  versionsOf: (dependency: Dependency) => readonly string[] | undefined,
  fetch: GuardedFetch,
  bases: RegistryBases,
): Promise<OsvResult> {
  const { ids, answered } = await malwareIds(dependencies, fetch, bases.osv);
  const malware = new Map<Dependency, string>();
  const checks = [...ids].flatMap(([dependency, found]) =>
    found.map((id) => ({ dependency, id })),
  );
  await inBatches(
    checks.slice(0, MAX_ADVISORIES),
    8,
    async ({ dependency, id }) => {
      if (malware.has(dependency)) return;
      const response = await fetch(`${bases.osv}/v1/vulns/${id}`, {
        timeoutMs: TIMEOUT_MS,
      });
      if (!response.ok || response.status !== 200) return;
      if (coversWholePackage(parse(response.body), versionsOf(dependency)))
        malware.set(dependency, id);
    },
  );
  return { malware, answered };
}
