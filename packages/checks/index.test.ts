import { describe, expect, it } from 'vitest';
import { checks } from './index';

describe('checks', () => {
  it('have unique ids', () => {
    const ids = checks.map((check) => check.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
