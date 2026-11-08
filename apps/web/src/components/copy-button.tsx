'use client';

import { useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyButton({
  text,
  label = 'Copy fix prompt',
  failedLabel = "Couldn't copy. Open the prompt below to copy it by hand.",
}: {
  text: string;
  label?: string;
  failedLabel?: string;
}) {
  const labels: Record<CopyState, string> = {
    idle: label,
    copied: 'Copied',
    failed: failedLabel,
  };
  const [state, setState] = useState<CopyState>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <button type="button" onClick={copy} aria-live="polite">
      {labels[state]}
    </button>
  );
}
