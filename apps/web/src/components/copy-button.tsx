'use client';

import { useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

const LABELS: Record<CopyState, string> = {
  idle: 'Copy fix prompt',
  copied: 'Copied',
  failed: "Couldn't copy. It's under Learn more.",
};

export function CopyButton({ text }: { text: string }) {
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
      {LABELS[state]}
    </button>
  );
}
