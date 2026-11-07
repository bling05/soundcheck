import type { Finding, ManualFix } from '@soundcheck/report';
import type { SecretRuleId } from './rules';

type RuleContent = Pick<Finding, 'title' | 'severity' | 'manualFix'> & {
  /** What to ask an AI tool to change. */
  fixRequest: string;
};

function serverOnlyFix(
  service: string,
  variable: string,
  newKeyFrom: string,
): ManualFix {
  return {
    description: `Do these in order. 1. Search your code and hosting settings for everywhere this key is used, so you know what will need the new one. 2. Create a new key in ${newKeyFrom}. 3. Move all ${service} calls to code that only runs on your server, and give it the new key through a private environment variable. 4. Delete the old key. Removing it from your code isn't enough, because anyone who already copied it can still use it until it's deleted.`,
    language: 'ts',
    snippet: `// Runs on your server only. Never start this name with NEXT_PUBLIC_ or VITE_.\nconst key = process.env.${variable};`,
  };
}

function fixRequestFor(service: string, variable: string): string {
  return `Move every ${service} call out of browser code and into code that only runs on the server, reading the key from a private environment variable named ${variable}. The name must not start with NEXT_PUBLIC_ or VITE_. Remove the key from the code entirely, and don't print it or repeat it. Then remind me that I still need to create a new key and delete the old one myself, because the old one is already public.`;
}

// Severity reflects what a stranger could do with the key today. The first three give
// control over data, money, or a whole project. The others mainly run up bills, or depend
// on what the key's been allowed to do.
export const RULE_CONTENT: Record<SecretRuleId, RuleContent> = {
  'supabase-secret': {
    title: "Your Supabase secret key is in your site's public code",
    severity: 'critical',
    manualFix: serverOnlyFix(
      'Supabase secret key',
      'SUPABASE_SECRET_KEY',
      'your Supabase project settings',
    ),
    fixRequest: fixRequestFor('Supabase secret key', 'SUPABASE_SECRET_KEY'),
  },
  'stripe-secret': {
    title: "Your Stripe secret key is in your site's public code",
    severity: 'critical',
    manualFix: serverOnlyFix(
      'Stripe',
      'STRIPE_SECRET_KEY',
      'your Stripe dashboard',
    ),
    fixRequest: fixRequestFor('Stripe', 'STRIPE_SECRET_KEY'),
  },
  'private-key': {
    title: "A private key is in your site's public code",
    severity: 'critical',
    manualFix: serverOnlyFix(
      'code that uses this private key,',
      'SERVICE_ACCOUNT_KEY',
      'the service that issued it, such as your Firebase project settings',
    ),
    fixRequest: fixRequestFor('use of this private key', 'SERVICE_ACCOUNT_KEY'),
  },
  'openai-key': {
    title: "Your OpenAI API key is in your site's public code",
    severity: 'high',
    manualFix: serverOnlyFix(
      'OpenAI',
      'OPENAI_API_KEY',
      'your OpenAI dashboard',
    ),
    fixRequest: fixRequestFor('OpenAI', 'OPENAI_API_KEY'),
  },
  'anthropic-key': {
    title: "Your Anthropic API key is in your site's public code",
    severity: 'high',
    manualFix: serverOnlyFix(
      'Anthropic',
      'ANTHROPIC_API_KEY',
      'your Anthropic Console',
    ),
    fixRequest: fixRequestFor('Anthropic', 'ANTHROPIC_API_KEY'),
  },
  'aws-key': {
    title: "An AWS key ID is in your site's public code",
    severity: 'high',
    manualFix: serverOnlyFix(
      'AWS',
      'AWS_SECRET_ACCESS_KEY',
      'your AWS account',
    ),
    fixRequest: fixRequestFor('AWS', 'AWS_SECRET_ACCESS_KEY'),
  },
};
