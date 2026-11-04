import type { Finding, ManualFix } from '@soundcheck/report';
import type { SecretRuleId } from './rules';

type RuleContent = Pick<
  Finding,
  'title' | 'severity' | 'lesson' | 'manualFix'
> & {
  /** What to ask an AI tool to change. */
  fixRequest: string;
};

const OWASP = [
  'A02:2021 Cryptographic Failures',
  'A05:2021 Security Misconfiguration',
];
const CWE = ['CWE-200', 'CWE-798'];

const WHY_AI_TOOLS_PRODUCE_IT =
  "AI tools often connect a service the quickest way, by calling it straight from the browser. That works right away, but anything browser code uses gets sent to every visitor. Names starting with NEXT_PUBLIC_ or VITE_ do this too: they're copied into your public code.";

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
    lesson: {
      whatItIs:
        'Supabase has two kinds of key. The anon key is meant to be public, and your security rules limit what it can do. The secret key, also called service role, skips those rules completely.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
      howItIsExploited:
        'Anyone can open your site, read its code, and copy this key. With it they can read, change, or delete everything in your database, including all your users’ data.',
      owasp: OWASP,
      cwe: CWE,
    },
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
    lesson: {
      whatItIs:
        'A Stripe secret key lets a program act as your business on Stripe. It is different from your publishable key, which starts with pk_ and is meant to be public.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
      howItIsExploited:
        'Anyone who copies this key from your site may be able to see your customers and payments, or issue refunds, depending on what the key is allowed to do.',
      owasp: OWASP,
      cwe: CWE,
    },
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
    lesson: {
      whatItIs:
        'A private key proves that a request really comes from you. Firebase and Google service accounts use one, and it often gives full access to a whole project.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
      howItIsExploited:
        'Anyone who copies this key from your site can act as you. For a Firebase service account, that can mean reading and changing all of your data, skipping your security rules.',
      owasp: OWASP,
      cwe: ['CWE-200', 'CWE-321'],
    },
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
    lesson: {
      whatItIs:
        'An OpenAI API key lets a program use OpenAI and bills the usage to your account.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
      howItIsExploited:
        'Anyone who copies this key from your site can run requests on your account, and you get the bill. Leaked AI keys are a common target because they can be turned into money quickly.',
      owasp: OWASP,
      cwe: CWE,
    },
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
    lesson: {
      whatItIs:
        'An Anthropic API key lets a program use Claude and bills the usage to your account.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
      howItIsExploited:
        'Anyone who copies this key from your site can run requests on your account, and you get the bill. Leaked AI keys are a common target because they can be turned into money quickly.',
      owasp: OWASP,
      cwe: CWE,
    },
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
    lesson: {
      whatItIs:
        'This is the ID half of an AWS access key. It needs a matching secret to work, and that secret is often stored right next to it, though we only looked for the ID.',
      whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
      howItIsExploited:
        'If the matching secret is in your code too, anyone who copies them can use your AWS account with whatever access the key has, which can include your files, your data, and your bill.',
      owasp: OWASP,
      cwe: CWE,
    },
    manualFix: serverOnlyFix(
      'AWS',
      'AWS_SECRET_ACCESS_KEY',
      'your AWS account',
    ),
    fixRequest: fixRequestFor('AWS', 'AWS_SECRET_ACCESS_KEY'),
  },
};
