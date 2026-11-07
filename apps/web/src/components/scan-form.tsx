'use client';

import { useActionState } from 'react';
import { startScan, type StartScanState } from '@/app/actions';

/** The home page's scan box. Submitting queues a scan and goes to its page. */
export function ScanForm() {
  const [state, action, pending] = useActionState<StartScanState, FormData>(
    startScan,
    {},
  );

  return (
    <form className="scan-form" action={action}>
      <label htmlFor="scan-url">Your app&apos;s link</label>
      <div className="scan-row">
        {/* Text, not url, so the browser doesn't reject a link typed without https://. */}
        <input
          id="scan-url"
          name="url"
          type="text"
          inputMode="url"
          placeholder="https://your-app.com"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Starting…' : 'Scan'}
        </button>
      </div>
      <details>
        <summary>Also scan a GitHub repo</summary>
        <label htmlFor="scan-repo">Repo link</label>
        <input
          id="scan-repo"
          name="repo"
          type="text"
          inputMode="url"
          placeholder="https://github.com/you/your-app"
          autoCapitalize="none"
          spellCheck={false}
        />
      </details>
      <p className="scan-status" aria-live="polite">
        {state.message}
      </p>
    </form>
  );
}
