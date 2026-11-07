/** A fresh, unguessable code for one page load. Only scripts carrying it are allowed to run. */
export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

/**
 * The Content-Security-Policy for one page load. Scripts run only if they carry this load's
 * nonce, so a script an attacker slips into a page is blocked. Next.js adds the nonce to its
 * own scripts and styles by reading it from this header.
 */
export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // React uses eval in development only, to show better error messages.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Next.js's development tools style themselves inline. Production stays nonce-only.
    isDev
      ? "style-src 'self' 'unsafe-inline'"
      : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Headers every response gets, set in next.config. Soundcheck must pass its own checks, so
 * these cover everything Check #1 looks for, plus a few more.
 */
export const SECURITY_HEADERS = [
  // Two years. Browsers then refuse plain http for this site.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Scan links are private. This stops the browser telling other sites which page a click
  // came from, which would include the scan's link.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
];
