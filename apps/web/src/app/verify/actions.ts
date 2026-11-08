'use server';

import {
  checkVerification,
  guardedFetch,
  verificationCode,
} from '@soundcheck/checks';
import { parseScanUrl } from '@soundcheck/shared';
import { redirect } from 'next/navigation';
import { describeError } from '@/server/run-scan';
import {
  ensureVerificationSecret,
  readVerificationSecret,
} from '@/server/verification';

export interface CheckSiteState {
  status?: 'verified' | 'not-found' | 'error';
  message?: string;
}

/** Gives this browser a verification secret if it has none, then shows the site's code. */
export async function getVerificationCode(form: FormData): Promise<void> {
  const parsed = parseScanUrl(String(form.get('site') ?? ''));
  if (!parsed.ok) redirect('/');
  await ensureVerificationSecret();
  redirect(`/verify?site=${encodeURIComponent(parsed.url)}`);
}

/** Looks for this browser's code on the site, on the page and in the verification file. */
export async function checkSite(
  _previous: CheckSiteState,
  form: FormData,
): Promise<CheckSiteState> {
  const parsed = parseScanUrl(String(form.get('site') ?? ''));
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  const secret = await readVerificationSecret();
  if (!secret) {
    return {
      status: 'error',
      message: 'Get your code first, then add it to your site.',
    };
  }

  try {
    const code = verificationCode(secret, new URL(parsed.url).hostname);
    const result = await checkVerification(parsed.url, code, guardedFetch);
    if (result.verified) {
      return {
        status: 'verified',
        message:
          result.method === 'meta-tag'
            ? 'Verified. We found your code in the page.'
            : 'Verified. We found your code in the verification file.',
      };
    }
    return {
      status: result.reason === 'not-found' ? 'not-found' : 'error',
      message: result.message,
    };
  } catch (error) {
    console.error('Verification check failed:', describeError(error));
    return {
      status: 'error',
      message: "We couldn't check your site. Try again in a minute.",
    };
  }
}
