import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ACTIVE_SCANS,
  MAX_SCANS_PER_VISITOR_PER_HOUR,
  SCANS_PER_VISITOR_PER_HOUR,
  scansPerVisitorPerHour,
  scanRefusal,
  visitorIp,
  visitorKey,
} from './limits';

afterEach(() => vi.unstubAllEnvs());

describe('scanRefusal', () => {
  it('allows a scan under every limit', () => {
    expect(scanRefusal({ byVisitorLastHour: 0, active: 0 })).toBeUndefined();
    expect(
      scanRefusal({
        byVisitorLastHour: SCANS_PER_VISITOR_PER_HOUR - 1,
        active: MAX_ACTIVE_SCANS - 1,
      }),
    ).toBeUndefined();
  });

  it('refuses a visitor who has used up their scans for the hour', () => {
    expect(
      scanRefusal({ byVisitorLastHour: SCANS_PER_VISITOR_PER_HOUR, active: 0 }),
    ).toContain('in the last hour');
  });

  it('refuses new scans when too many are running', () => {
    expect(
      scanRefusal({ byVisitorLastHour: 0, active: MAX_ACTIVE_SCANS }),
    ).toContain('busy');
  });
});

describe('scansPerVisitorPerHour', () => {
  it('is the default unless the setting changes it', () => {
    expect(scansPerVisitorPerHour()).toBe(SCANS_PER_VISITOR_PER_HOUR);
  });

  it('can be raised for a while', () => {
    vi.stubEnv('SCANS_PER_VISITOR_PER_HOUR', '50');

    expect(scansPerVisitorPerHour()).toBe(50);
    expect(scanRefusal({ byVisitorLastHour: 10, active: 0 })).toBeUndefined();
  });

  it.each(['0', '-3', 'lots', '2.5', ''])(
    'ignores a setting of "%s"',
    (value) => {
      vi.stubEnv('SCANS_PER_VISITOR_PER_HOUR', value);

      expect(scansPerVisitorPerHour()).toBe(SCANS_PER_VISITOR_PER_HOUR);
    },
  );

  it("can't be raised so far that the limit is gone", () => {
    vi.stubEnv('SCANS_PER_VISITOR_PER_HOUR', '1000000');

    expect(scansPerVisitorPerHour()).toBe(MAX_SCANS_PER_VISITOR_PER_HOUR);
  });
});

describe('visitorIp', () => {
  it('uses the first address in x-forwarded-for, which is the visitor', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
    });

    expect(visitorIp(headers)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to a fixed value', () => {
    expect(visitorIp(new Headers({ 'x-real-ip': '203.0.113.8' }))).toBe(
      '203.0.113.8',
    );
    expect(visitorIp(new Headers())).toBe('unknown');
  });
});

describe('visitorKey', () => {
  it('never contains the IP, and is the same for the same visitor', () => {
    vi.stubEnv('SCAN_LIMIT_SECRET', 'test-secret');

    const key = visitorKey('203.0.113.7');

    expect(key).not.toContain('203');
    expect(visitorKey('203.0.113.7')).toBe(key);
    expect(visitorKey('203.0.113.8')).not.toBe(key);
  });

  it('changes with the secret, so the IP cannot be worked out without it', () => {
    vi.stubEnv('SCAN_LIMIT_SECRET', 'one');
    const first = visitorKey('203.0.113.7');
    vi.stubEnv('SCAN_LIMIT_SECRET', 'two');

    expect(visitorKey('203.0.113.7')).not.toBe(first);
  });

  it('refuses to run without a secret in production', () => {
    vi.stubEnv('SCAN_LIMIT_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => visitorKey('203.0.113.7')).toThrow('SCAN_LIMIT_SECRET');
  });
});
