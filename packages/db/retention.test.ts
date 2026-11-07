import { describe, expect, it } from 'vitest';
import { deletionDate, SCAN_RETENTION_DAYS } from './retention';

describe('deletionDate', () => {
  it('is the retention period after the scan was requested', () => {
    expect(SCAN_RETENTION_DAYS).toBe(14);
    expect(deletionDate(new Date('2026-11-07T20:00:00Z')).toISOString()).toBe(
      '2026-11-21T20:00:00.000Z',
    );
  });
});
