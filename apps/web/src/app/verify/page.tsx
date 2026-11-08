import {
  VERIFICATION_FILE_PATH,
  VERIFICATION_META_NAME,
  verificationCode,
} from '@soundcheck/checks';
import { parseScanUrl } from '@soundcheck/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CopyButton } from '@/components/copy-button';
import { VerifyCheck } from '@/components/verify-check';
import { readVerificationSecret } from '@/server/verification';
import { getVerificationCode } from './actions';

export const metadata: Metadata = {
  title: 'Verify your site | Soundcheck',
  robots: { index: false },
};

const COPY_FAILED = "Couldn't copy. Select the text above to copy it by hand.";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const parsed = parseScanUrl((await searchParams).site ?? '');
  if (!parsed.ok) {
    return (
      <main className="report">
        <h1>Verify your site</h1>
        <p>
          Scan your site first, then verify it from the report.{' '}
          <Link href="/">Scan a site</Link>
        </p>
      </main>
    );
  }

  const site = parsed.url;
  const hostname = new URL(site).hostname;
  const secret = await readVerificationSecret();

  return (
    <main className="report">
      <h1>Verify {hostname}</h1>
      <p>
        Some checks send requests to your database, not just your website. We
        only run those once you prove the site is yours, by putting a code on
        it.
      </p>

      {!secret ? (
        <form action={getVerificationCode}>
          <input type="hidden" name="site" value={site} />
          <button type="submit">Get my code</button>
        </form>
      ) : (
        <Instructions site={site} code={verificationCode(secret, hostname)} />
      )}
    </main>
  );
}

function Instructions({ site, code }: { site: string; code: string }) {
  const tag = `<meta name="${VERIFICATION_META_NAME}" content="${code}">`;
  const prompt = `Add this exact tag inside the <head> of index.html, written directly in the file rather than added by JavaScript, and change nothing else:\n\n${tag}`;
  const fileUrl = new URL(VERIFICATION_FILE_PATH, site).href;

  return (
    <>
      <h2>1. Add this tag to your site</h2>
      <p>
        It goes in the <code>&lt;head&gt;</code> of your home page. The easiest
        way is to paste this into your AI tool:
      </p>
      <pre>
        <code>{prompt}</code>
      </pre>
      <CopyButton text={prompt} label="Copy prompt" failedLabel={COPY_FAILED} />

      <details>
        <summary>Or use a file instead</summary>
        <p>
          Make a file at <code>{fileUrl}</code> that holds only this code:
        </p>
        <pre>
          <code>{code}</code>
        </pre>
      </details>

      <h2>2. Publish the change, then check</h2>
      <p>
        Leave the tag in place. We look for it on every scan, so taking it off
        stops the database checks.
      </p>
      <VerifyCheck site={site} />

      <p className="muted">
        Only this browser can use this code. Using another browser or device
        gives you a different one.
      </p>
    </>
  );
}
