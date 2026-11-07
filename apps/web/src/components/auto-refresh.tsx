'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-reads the page from the server every few seconds. Render it only while a scan is unfinished. */
export function AutoRefresh({ everyMs = 2_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
