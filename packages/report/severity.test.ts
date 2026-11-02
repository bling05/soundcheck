import { describe, expect, it } from 'vitest';
import { sortBySeverity } from './severity';
import type { Severity } from './severity';

describe('sortBySeverity', () => {
  it('puts the most severe findings first', () => {
    const findings: { severity: Severity }[] = [
      { severity: 'low' },
      { severity: 'critical' },
      { severity: 'medium' },
    ];

    expect(sortBySeverity(findings).map((f) => f.severity)).toEqual([
      'critical',
      'medium',
      'low',
    ]);
  });

  it('keeps the order of findings with equal severity', () => {
    const findings = [
      { id: 'a', severity: 'high' as const },
      { id: 'b', severity: 'high' as const },
    ];

    expect(sortBySeverity(findings).map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('does not change the original list', () => {
    const findings: { severity: Severity }[] = [
      { severity: 'low' },
      { severity: 'high' },
    ];

    sortBySeverity(findings);

    expect(findings[0]?.severity).toBe('low');
  });
});
