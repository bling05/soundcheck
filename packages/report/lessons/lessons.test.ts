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

  it.each(
    Object.entries(LESSONS).flatMap(([id, lesson]) =>
      'realCase' in lesson ? [[id, lesson.realCase]] : [],
    ),
  )('%s cites a real case with a working kind of link', (_id, realCase) => {
    expect(realCase.summary).not.toBe('');
    expect(realCase.source).not.toBe('');
    expect(new URL(realCase.url).protocol).toBe('https:');
  });

  it('uses no em dashes', () => {
    expect(JSON.stringify(LESSONS)).not.toContain('—');
  });
});
