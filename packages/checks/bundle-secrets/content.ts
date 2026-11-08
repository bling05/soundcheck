import type { Finding, ManualFix } from '@soundcheck/report';
import type { SecretRuleId } from './rules';

type RuleContent = Pick<Finding, 'title' | 'severity' | 'manualFix'> & {
  /** What to ask an AI tool to change. */
  fixRequest: string;
  /** What the owner must do themselves first. Without one, the key must be replaced. */
  safetyStep?: string;
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
  // Medium: it's meant to be public and is only dangerous if Gemini is on, which we can't
  // see from outside. Restricting it is the fix, not hiding it.
  'google-api-key': {
    title: "Check that the Google API key in your site's code can't use Gemini",
    severity: 'medium',
    safetyStep:
      "In Google Cloud, open APIs & Services, then Credentials, and edit this key. Under API restrictions, allow only the services your site uses, like Maps or Firebase, so it can never call Gemini. Under Application restrictions, allow only your site's address.",
    manualFix: {
      description:
        "This key is meant to be in your site's code, so don't remove it. Instead, limit what it can do in Google Cloud: open APIs & Services, then Credentials, edit the key, and under API restrictions allow only the services your site uses. Also check whether the Generative Language API (Gemini) is turned on in this project. If you need Gemini, use a separate key that only your server knows.",
      language: 'text',
      snippet:
        'Google Cloud console > APIs & Services > Credentials > (this key)\n  API restrictions: Restrict key, then choose only Maps, Firebase, and so on\n  Application restrictions: Websites, then https://your-site.example/*',
    },
    fixRequest:
      "List which Google services this app uses with its Google API key, like Maps, Firebase, or Gemini, and where in the code each one is used. Don't remove or move the key, since it's meant to be in browser code for Maps and Firebase. If the app calls Gemini from browser code, move those calls to the server with a separate key from a private environment variable named GEMINI_API_KEY. Then remind me to restrict the browser key in Google Cloud to only the services you listed.",
  },
};
