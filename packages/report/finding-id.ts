import type { CheckOutcome, ScanReport } from './report';
import { sortBySeverity } from './severity';
import type { Finding } from './types';

/**
 * Builds a finding's id from what the problem is and where it is, like
 * `security-headers:content-security-policy:/`. Never use anything that changes
 * between scans of an unchanged site, like the date or the finding's position.
 * Never use a full secret: use its redacted form.
 */
export function findingId(
  checkId: string,
  rule: string,
  ...where: string[]
): string {
  return [checkId, rule, ...where].join(':');
}

/**
 * Keeps ids unique when two findings would share one, like two different keys
 * that end in the same 4 characters. Later repeats get `:2`, `:3`, and so on.
 */
export function withUniqueIds<T extends { id: string }>(
  findings: readonly T[],
): T[] {
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const count = (seen.get(finding.id) ?? 0) + 1;
    seen.set(finding.id, count);
    return count === 1 ? finding : { ...finding, id: `${finding.id}:${count}` };
  });
}

export interface ScanComparison {
  /** Found last time, and the same check ran in full this time without finding it. */
  fixed: Finding[];
  /** Found both times. These are this scan's copies. */
  stillOpen: Finding[];
  /** Found this time but not last time. */
  new: Finding[];
  /**
   * Found last time, but the check that found it was skipped, only partly ran,
   * or didn't run this time, so we can't say whether it's fixed.
   */
  notRechecked: Finding[];
}

function findingsOf(outcomes: readonly CheckOutcome[]): Finding[] {
  return outcomes.flatMap((outcome) =>
    outcome.status === 'ran' ? outcome.findings : [],
  );
}

/**
 * Compares two scans of the same site by finding id. A finding only counts as
 * fixed when its check fully ran again, because a skipped check is never a pass.
 */
export function compareScans(
  previous: ScanReport,
  current: ScanReport,
): ScanComparison {
  const currentFindings = findingsOf(current.outcomes);
  const currentIds = new Set(currentFindings.map(({ id }) => id));
  const previousIds = new Set(
    findingsOf(previous.outcomes).map(({ id }) => id),
  );
  const fullyRan = new Set(
    current.outcomes
      .filter((outcome) => outcome.status === 'ran' && !outcome.note)
      .map(({ checkId }) => checkId),
  );

  const fixed: Finding[] = [];
  const notRechecked: Finding[] = [];
  for (const finding of findingsOf(previous.outcomes)) {
    if (currentIds.has(finding.id)) continue;
    (fullyRan.has(finding.checkId) ? fixed : notRechecked).push(finding);
  }

  return {
    fixed: sortBySeverity(fixed),
    stillOpen: sortBySeverity(
      currentFindings.filter(({ id }) => previousIds.has(id)),
    ),
    new: sortBySeverity(
      currentFindings.filter(({ id }) => !previousIds.has(id)),
    ),
    notRechecked: sortBySeverity(notRechecked),
  };
}
