import { describe, expect, it } from 'vitest';
import { redactSecret } from './redact';

describe('redactSecret', () => {
  it('keeps only the last 4 characters', () => {
    expect(redactSecret('fake-secret-value-1234')).toBe('****1234');
  });

  it('does not reveal the length of the secret', () => {
    expect(redactSecret('a'.repeat(20))).toHaveLength(
      redactSecret('a'.repeat(200)).length,
    );
  });

  it('fully masks short secrets', () => {
    expect(redactSecret('abc123')).toBe('****');
    expect(redactSecret('')).toBe('****');
  });
});
