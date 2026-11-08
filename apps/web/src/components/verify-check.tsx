'use client';

import { useActionState } from 'react';
import { startScan, type StartScanState } from '@/app/actions';
import { checkSite, type CheckSiteState } from '@/app/verify/actions';

/** The "Check my site" button, and once verified, a button to scan with every check. */
export function VerifyCheck({ site }: { site: string }) {
  const [state, check, checking] = useActionState<CheckSiteState, FormData>(
    checkSite,
    {},
  );
  const [scan, startScanAction, starting] = useActionState<
    StartScanState,
    FormData
  >(startScan, {});

  return (
    <>
      <form action={check}>
        <input type="hidden" name="site" value={site} />
        <button type="submit" disabled={checking}>
          {checking ? 'Checking…' : 'Check my site'}
        </button>
      </form>
      <p className="scan-status" aria-live="polite">
        {state.message}
      </p>
      {state.status === 'verified' && (
        <form action={startScanAction}>
          <input type="hidden" name="url" value={site} />
          <button type="submit" disabled={starting}>
            {starting ? 'Starting…' : 'Scan with every check'}
          </button>
          <p className="scan-status" aria-live="polite">
            {scan.message}
          </p>
        </form>
      )}
    </>
  );
}
