import { describe, expect, it } from 'vitest';
import { compareScans, findingId, withUniqueIds } from './finding-id';
import type { CheckOutcome, ScanReport } from './report';
import type { Severity } from './severity';
import type { Finding } from './types';

function finding(
  id: string,
  checkId = 'a',
  severity: Severity = 'low',
): Finding {
  return {
    id,
    checkId,
    title: id,
    severity,
    source: 'live',
    evidence: [],
    lesson: {
      whatItIs: '',
      whyAiToolsProduceIt: '',
      howItIsExploited: '',
      owasp: [],
      cwe: [],
    },
    manualFix: { description: '', language: 'text', snippet: '' },
    aiFix: { problem: id, request: '' },
  };
}

const ran = (
  checkId: string,
  findings: Finding[],
  note?: string,
): CheckOutcome => ({ checkId, title: checkId, status: 'ran', findings, note });

const skipped = (checkId: string): CheckOutcome => ({
  checkId,
  title: checkId,
  status: 'skipped',
  reason: 'The site took too long to respond.',
});

const scan = (...outcomes: CheckOutcome[]): ScanReport => ({
  url: 'https://site.test/',
  scannedAt: '2026-11-05T12:00:00.000Z',
  outcomes,
  notAttempted: [],
});

const ids = (findings: Finding[]) => findings.map(({ id }) => id);

describe('findingId', () => {
  it('joins the check, rule, and place', () => {
    expect(findingId('security-headers', 'content-security-policy', '/')).toBe(
      'security-headers:content-security-policy:/',
    );
  });
});

describe('withUniqueIds', () => {
  it('numbers repeats in order and leaves the first alone', () => {
    const result = withUniqueIds([
      finding('x'),
      finding('y'),
      finding('x'),
      finding('x'),
    ]);

    expect(ids(result)).toEqual(['x', 'y', 'x:2', 'x:3']);
  });
});

describe('compareScans', () => {
  it('sorts findings into fixed, still open, and new', () => {
    const before = scan(ran('a', [finding('old'), finding('both')]));
    const after = scan(ran('a', [finding('both'), finding('fresh')]));

    const result = compareScans(before, after);

    expect(ids(result.fixed)).toEqual(['old']);
    expect(ids(result.stillOpen)).toEqual(['both']);
    expect(ids(result.new)).toEqual(['fresh']);
    expect(result.notRechecked).toEqual([]);
  });

  it('never calls a finding fixed when its check was skipped', () => {
    const result = compareScans(
      scan(ran('a', [finding('old')])),
      scan(skipped('a')),
    );

    expect(result.fixed).toEqual([]);
    expect(ids(result.notRechecked)).toEqual(['old']);
  });

  it('never calls a finding fixed when its check only partly ran', () => {
    const result = compareScans(
      scan(ran('a', [finding('old')])),
      scan(ran('a', [], "We couldn't read all of your site's code.")),
    );

    expect(result.fixed).toEqual([]);
    expect(ids(result.notRechecked)).toEqual(['old']);
  });

  it("never calls a finding fixed when its check didn't run at all", () => {
    const result = compareScans(
      scan(ran('a', []), ran('b', [finding('old', 'b')])),
      scan(ran('a', [])),
    );

    expect(ids(result.notRechecked)).toEqual(['old']);
  });

  it('still counts something found by a partly run check as open', () => {
    const result = compareScans(
      scan(ran('a', [finding('both')])),
      scan(ran('a', [finding('both')], 'Partial.')),
    );

    expect(ids(result.stillOpen)).toEqual(['both']);
  });

  it('puts the worst first in every group', () => {
    const result = compareScans(
      scan(ran('a', [])),
      scan(
        ran('a', [
          finding('minor', 'a', 'low'),
          finding('serious', 'a', 'critical'),
        ]),
      ),
    );

    expect(ids(result.new)).toEqual(['serious', 'minor']);
  });
});
