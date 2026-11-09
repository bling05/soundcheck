import { redactSecret } from '@soundcheck/shared';
import type { GuardedFetch } from '../request-guard';
import type { SiteFile } from '../site-files';
import { matchSecrets } from './rules';

export type GeminiAccess = 'works' | 'blocked' | 'unknown';

export const GEMINI_MODELS =
  'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Asks Google for its list of Gemini models with this key. Listing models is free and
 * changes nothing, so it's a safe way to learn whether the key works for Gemini. Only run
 * for a verified owner, on the key their own site exposes.
 */
export async function geminiAccess(
  key: string,
  fetch: GuardedFetch,
  base = GEMINI_MODELS,
): Promise<GeminiAccess> {
  const response = await fetch(
    `${base}?pageSize=1&key=${encodeURIComponent(key)}`,
    { timeoutMs: 8_000, maxBytes: 64 * 1024 },
  );
  if (!response.ok) return 'unknown';
  if (response.status === 200) return 'works';
  // 400: not a valid key. 403: Gemini is off for this project, or the key is restricted.
  if (response.status === 400 || response.status === 403) return 'blocked';
  return 'unknown';
}

/**
 * The full Google keys in the site's code, by their redacted form, so a finding can be
 * matched to its key. The keys stay in memory for the test and are never stored.
 */
export function googleKeysByRedacted(
  files: readonly SiteFile[],
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const { text } of files) {
    for (const { rule, secret } of matchSecrets(text)) {
      if (rule === 'google-api-key') keys.set(redactSecret(secret), secret);
    }
  }
  return keys;
}
