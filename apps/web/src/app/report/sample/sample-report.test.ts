import { summarizeReport } from '@soundcheck/report';
import { describe, expect, it } from 'vitest';
import { SAMPLE_REPORT } from './sample-report';

describe('sample report', () => {
  it('opens with its most severe finding', () => {
    const summary = summarizeReport(SAMPLE_REPORT);

    expect(summary.findings[0]?.severity).toBe('critical');
    expect(summary.headline).toBe('Here are the vulnerabilities we found.');
  });

  it('has one fix prompt covering all of its findings', () => {
    const summary = summarizeReport(SAMPLE_REPORT);

    for (const { title } of summary.findings) {
      expect(summary.fixPrompt).toContain(title);
    }
  });

  it('lists what was not checked', () => {
    expect(summarizeReport(SAMPLE_REPORT).notChecked.length).toBeGreaterThan(0);
  });

  it('uses no em dashes', () => {
    expect(JSON.stringify(SAMPLE_REPORT)).not.toContain('—');
  });
});
