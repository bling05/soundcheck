import type { FixtureSite } from './server';

const PAGE = '<!doctype html><title>Fixture</title><h1>Hello</h1>';

/** Sends none of the security headers. */
export const missingSecurityHeaders: FixtureSite = {
  '/': { headers: { 'content-type': 'text/html' }, body: PAGE },
};

/** Sends all of them with strict values. */
export const secureSecurityHeaders: FixtureSite = {
  '/': {
    headers: {
      'content-type': 'text/html',
      'content-security-policy': "default-src 'self'",
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
    body: PAGE,
  },
};
