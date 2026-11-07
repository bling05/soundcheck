import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, createNonce } from '@/server/csp';

/** Gives every page load its own Content-Security-Policy with a fresh nonce. */
export function proxy(request: NextRequest) {
  const policy = contentSecurityPolicy(
    createNonce(),
    process.env.NODE_ENV === 'development',
  );

  // Next.js reads the nonce from the request's copy of the header while rendering.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. Static files and prefetches don't run scripts.
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
