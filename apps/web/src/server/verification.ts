import { createVerificationSecret } from '@soundcheck/checks';
import { cookies } from 'next/headers';

/**
 * The browser's verification secret lives in a cookie only the server can read. JavaScript
 * on the page can't see it, other sites can't send it, and it only travels over HTTPS.
 */
const COOKIE = 'soundcheck_owner';
const NINETY_DAYS = 90 * 24 * 60 * 60;
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** This browser's secret, or undefined if it has never started verifying a site. */
export async function readVerificationSecret(): Promise<string | undefined> {
  const value = (await cookies()).get(COOKIE)?.value;
  return value && SECRET_SHAPE.test(value) ? value : undefined;
}

/** Returns this browser's secret, making one first if needed. Server actions only. */
export async function ensureVerificationSecret(): Promise<string> {
  const existing = await readVerificationSecret();
  if (existing) return existing;
  const secret = createVerificationSecret();
  (await cookies()).set(COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: NINETY_DAYS,
  });
  return secret;
}
