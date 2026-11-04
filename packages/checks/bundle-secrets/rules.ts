import { redactSecret } from '@soundcheck/shared';
import type { SiteFile } from '../site-files';

export type SecretRuleId =
  | 'supabase-secret'
  | 'stripe-secret'
  | 'private-key'
  | 'openai-key'
  | 'anthropic-key'
  | 'aws-key';

interface SecretRule {
  id: SecretRuleId;
  /** Capture group 1, if there is one, holds the part that counts as the secret. */
  pattern: RegExp;
  isReal(secret: string): boolean;
}

export interface Leak {
  rule: SecretRuleId;
  /** Last 4 characters only. The full key never leaves this file. */
  redacted: string;
  /** Files the key was found in, in the order they were read. */
  locations: string[];
}

const PLACEHOLDER_WORDS = /example|your|placeholder|dummy|sample|fake|xxxx/i;
const MIN_DISTINCT_CHARACTERS = 8;
// Only the end of the key, because a fixed prefix like `sk_live_` would count as variety.
const VARIETY_SAMPLE_LENGTH = 16;

/** Real keys are random. `sk_live_abcabcabcabcabcabcabcabc` is someone's placeholder. */
function hasVariety(secret: string): boolean {
  const sample = secret.slice(-VARIETY_SAMPLE_LENGTH);
  return new Set(sample).size >= MIN_DISTINCT_CHARACTERS;
}

function looksReal(secret: string): boolean {
  return hasVariety(secret) && !PLACEHOLDER_WORDS.test(secret);
}

/**
 * Supabase's anon and service role keys look identical until you read the role inside.
 * The anon key is public by design. `supabase-demo` keys are the published defaults for
 * running Supabase locally, so they aren't anyone's secret.
 */
function isServiceRoleToken(token: string): boolean {
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    );
    return (
      typeof claims === 'object' &&
      claims !== null &&
      'role' in claims &&
      claims.role === 'service_role' &&
      !('iss' in claims && claims.iss === 'supabase-demo')
    );
  } catch {
    return false;
  }
}

// Keep these narrow. Each one matches a format the provider documents, not just a name, so
// a CSS class like `sk-circle-fade-dot` or a library's PEM constant doesn't count.
// Order matters: findings come back in this order, so the same site always reads the same.
const SECRET_RULES: readonly SecretRule[] = [
  {
    id: 'supabase-secret',
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    isReal: isServiceRoleToken,
  },
  {
    id: 'supabase-secret',
    pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}/g,
    isReal: looksReal,
  },
  {
    id: 'stripe-secret',
    pattern: /\b[sr]k_live_[0-9a-zA-Z]{24,}\b/g,
    isReal: looksReal,
  },
  {
    id: 'private-key',
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----([A-Za-z0-9+/=\\\s]{100,})-----END/g,
    isReal: hasVariety,
  },
  {
    id: 'openai-key',
    pattern:
      /\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{40,}\b)/g,
    isReal: looksReal,
  },
  {
    id: 'anthropic-key',
    pattern: /\bsk-ant-[a-z0-9]+-[A-Za-z0-9_-]{40,}/g,
    isReal: looksReal,
  },
  {
    id: 'aws-key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    isReal: looksReal,
  },
];

/** Removes line breaks from a key, written either as real ones or as `\n` in code. */
function compact(secret: string): string {
  return secret.replace(/\\n|\s/g, '');
}

/** Finds real keys. Each distinct key is one leak, however many files it appears in. */
export function findLeaks(files: readonly SiteFile[]): Leak[] {
  const leaks: Leak[] = [];

  for (const { id, pattern, isReal } of SECRET_RULES) {
    const byKey = new Map<string, Leak>();
    for (const { location, text } of files) {
      for (const match of text.matchAll(pattern)) {
        const secret = compact(match[1] ?? match[0]);
        if (!isReal(secret)) continue;

        const leak = byKey.get(secret);
        if (!leak) {
          byKey.set(secret, {
            rule: id,
            redacted: redactSecret(secret),
            locations: [location],
          });
        } else if (!leak.locations.includes(location)) {
          leak.locations.push(location);
        }
      }
    }
    leaks.push(...byKey.values());
  }

  return leaks;
}
