const MASK = '****';
const VISIBLE_CHARS = 4;
// Below this length, the last 4 characters give away too much of the secret.
const MIN_LENGTH_TO_REVEAL = 12;

/** Redacts a secret to its last 4 characters. Short secrets are fully masked. */
export function redactSecret(secret: string): string {
  if (secret.length < MIN_LENGTH_TO_REVEAL) return MASK;
  return `${MASK}${secret.slice(-VISIBLE_CHARS)}`;
}
