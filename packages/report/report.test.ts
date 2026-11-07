import { describe, expect, it } from 'vitest';
import { summarizeReport, type CheckOutcome, type ScanReport } from './report';
import type { Severity } from './severity';
import type { Finding } from './types';

function finding(title: string, severity: Severity): Finding {
  return {
    id: `test:${title}`,
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
    aiFix: { problem: title, request: `Fix ${title}.` },
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
  it('sorts findings across checks, worst first', () => {
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
    expect(summary.headline).toBe('Here are the vulnerabilities we found.');
  });

  it('builds one fix prompt from every finding, worst first', () => {
    const { fixPrompt } = summarizeReport({
      ...report([
        ran('A', [finding('low one', 'low')]),
        ran('B', [finding('critical one', 'critical')]),
      ]),
      tool: 'cursor',
    });

    expect(fixPrompt).toContain('this Cursor project');
    expect(fixPrompt?.indexOf('critical one')).toBeLessThan(
      fixPrompt?.indexOf('low one') ?? -1,
    );
  });

  it('passes the detected stack to the fix prompt', () => {
    const { fixPrompt } = summarizeReport({
      ...report([ran('A', [finding('x', 'low')])]),
      stack: ['vite'],
    });

    expect(fixPrompt).toContain('The scan detected Vite.');
  });

  it('has no fix prompt when there is nothing to fix', () => {
    expect(summarizeReport(report([ran('A')])).fixPrompt).toBeUndefined();
  });

  it('uses the singular for one finding', () => {
    const summary = summarizeReport(report([ran('A', [finding('x', 'low')])]));

    expect(summary.headline).toBe('Here are the vulnerabilities we found.');
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
  });

  it('says so when nothing could be checked', () => {
    const summary = summarizeReport(report([skipped('A', 'Blocked.')]));

    expect(summary.headline).toContain("couldn't check anything");
    expect(summary.noProblemsFound).toEqual([]);
  });
});
