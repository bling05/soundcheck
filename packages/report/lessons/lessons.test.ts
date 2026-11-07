import { describe, expect, it } from 'vitest';
import { LESSONS } from './index';

describe('lessons', () => {
  it.each(Object.entries(LESSONS))('%s is complete', (_id, lesson) => {
    expect(lesson.whatItIs).not.toBe('');
    expect(lesson.whyAiToolsProduceIt).not.toBe('');
    expect(lesson.howItIsExploited).not.toBe('');
    expect(lesson.owasp.length).toBeGreaterThan(0);
    expect(lesson.cwe.length).toBeGreaterThan(0);
  });

  it('uses no em dashes', () => {
    expect(JSON.stringify(LESSONS)).not.toContain('—');
  });
});
