export const SEVERITIES = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
] as const;

export type Severity = (typeof SEVERITIES)[number];

/** Returns a new list, most severe first. Findings of equal severity keep their order. */
export function sortBySeverity<T extends { severity: Severity }>(
  findings: readonly T[],
): T[] {
  return findings.toSorted(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
  );
}
