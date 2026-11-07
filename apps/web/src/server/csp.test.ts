import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, createNonce, SECURITY_HEADERS } from './csp';

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1);

describe('createNonce', () => {
  it('is different every time', () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe('contentSecurityPolicy in production', () => {
  const policy = contentSecurityPolicy('abc123', false);

  it("only runs scripts carrying this page load's nonce", () => {
    expect(directive(policy, 'script-src')).toBe(
      "'self' 'nonce-abc123' 'strict-dynamic'",
    );
  });

  it('never allows inline styles or eval', () => {
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('stops other sites from framing Soundcheck', () => {
    expect(directive(policy, 'frame-ancestors')).toBe("'none'");
  });
});

describe('contentSecurityPolicy in development', () => {
  it('loosens only what Next.js development tools need', () => {
    const policy = contentSecurityPolicy('abc123', true);

    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'style-src')).toBe("'self' 'unsafe-inline'");
  });
});

describe('SECURITY_HEADERS', () => {
  it('keeps scan links out of the Referer header', () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: 'Referrer-Policy',
      value: 'no-referrer',
    });
  });
});
