import { describe, expect, it } from 'vitest';
import { summarizeReport, type CheckOutcome, type ScanReport } from './report';
import type { Severity } from './severity';
import type { Finding } from './types';

function finding(title: string, severity: Severity): Finding {
  return {
    checkId: 'test',
    title,
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
    aiFixPrompt: '',
  };
}

function report(
  outcomes: CheckOutcome[],
  notAttempted: ScanReport['notAttempted'] = [],
): ScanReport {
  return {
    url: 'https://site.test/',
    scannedAt: '2026-11-04T12:00:00.000Z',
    outcomes,
    notAttempted,
  };
}

const ran = (
  title: string,
  findings: Finding[] = [],
  note?: string,
): CheckOutcome => ({
  checkId: title,
  title,
  status: 'ran',
  findings,
  note,
});

const skipped = (title: string, reason: string): CheckOutcome => ({
  checkId: title,
  title,
  status: 'skipped',
  reason,
});

describe('summarizeReport', () => {
  it('sorts findings across checks and picks the worst to fix first', () => {
    const summary = summarizeReport(
      report([
        ran('A', [finding('low one', 'low')]),
        ran('B', [finding('critical one', 'critical')]),
      ]),
    );

    expect(summary.findings.map(({ title }) => title)).toEqual([
      'critical one',
      'low one',
    ]);
    expect(summary.fixFirst?.title).toBe('critical one');
    expect(summary.headline).toBe('We found 2 things to fix.');
  });

  it('uses the singular for one finding', () => {
    const summary = summarizeReport(report([ran('A', [finding('x', 'low')])]));

    expect(summary.headline).toBe('We found 1 thing to fix.');
  });

  it('counts only the severities present, worst first', () => {
    const summary = summarizeReport(
      report([
        ran('A', [
          finding('a', 'low'),
          finding('b', 'high'),
          finding('c', 'low'),
        ]),
      ]),
    );

    expect(summary.severityCounts).toEqual([
      { severity: 'high', count: 1 },
      { severity: 'low', count: 2 },
    ]);
  });

  it('never shows a skipped check as having no problems', () => {
    const summary = summarizeReport(
      report([ran('Clean'), skipped('Blocked', 'The site refused us.')]),
    );

    expect(summary.noProblemsFound).toEqual(['Clean']);
    expect(summary.notChecked).toEqual([
      { title: 'Blocked', reason: 'The site refused us.' },
    ]);
  });

  it('never shows a partly read check as having no problems', () => {
    const summary = summarizeReport(
      report([ran('Partial', [], 'We read only part of your code.')]),
    );

    expect(summary.noProblemsFound).toEqual([]);
    expect(summary.notChecked).toEqual([
      { title: 'Partial', reason: 'We read only part of your code.' },
    ]);
  });

  it('keeps findings from a partly read check and lists the gap', () => {
    const summary = summarizeReport(
      report([ran('Partial', [finding('leak', 'critical')], 'Partly read.')]),
    );

    expect(summary.findings).toHaveLength(1);
    expect(summary.notChecked[0]?.title).toBe('Partial');
  });

  it('lists checks this scan never tried', () => {
    const summary = summarizeReport(
      report([ran('A')], [{ title: 'Database rules', reason: 'Needs proof.' }]),
    );

    expect(summary.notChecked).toEqual([
      { title: 'Database rules', reason: 'Needs proof.' },
    ]);
  });

  it('does not call a clean result secure', () => {
    const summary = summarizeReport(report([ran('A'), ran('B')]));

    expect(summary.headline).toContain('2 checks');
    expect(summary.headline).toContain(
      "doesn't mean your site is fully secure",
    );
    expect(summary.fixFirst).toBeUndefined();
  });

  it('says so when nothing could be checked', () => {
    const summary = summarizeReport(report([skipped('A', 'Blocked.')]));

    expect(summary.headline).toContain("couldn't check anything");
    expect(summary.noProblemsFound).toEqual([]);
  });
});
