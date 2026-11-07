import type { Lesson } from '../types';

const OWASP = [
  'A02:2021 Cryptographic Failures',
  'A05:2021 Security Misconfiguration',
];
const CWE = ['CWE-200', 'CWE-798'];

const WHY_AI_TOOLS_PRODUCE_IT =
  "AI tools often connect a service the quickest way, by calling it straight from the browser. That works right away, but anything browser code uses gets sent to every visitor. Names starting with NEXT_PUBLIC_ or VITE_ do this too: they're copied into your public code.";

const AI_KEY_EXPLOIT =
  'Anyone who copies this key from your site can run requests on your account, and you get the bill. Leaked AI keys are a common target because they can be turned into money quickly.';

export const BUNDLE_SECRETS_LESSONS = {
  'bundle-secrets:supabase-secret': {
    whatItIs:
      'Supabase has two kinds of key. The anon key is meant to be public, and your security rules limit what it can do. The secret key, also called service role, skips those rules completely.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      'Anyone can open your site, read its code, and copy this key. With it they can read, change, or delete everything in your database, including all your users’ data.',
    owasp: OWASP,
    cwe: CWE,
  },
  'bundle-secrets:stripe-secret': {
    whatItIs:
      'A Stripe secret key lets a program act as your business on Stripe. It is different from your publishable key, which starts with pk_ and is meant to be public.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      'Anyone who copies this key from your site may be able to see your customers and payments, or issue refunds, depending on what the key is allowed to do.',
    owasp: OWASP,
    cwe: CWE,
  },
  'bundle-secrets:private-key': {
    whatItIs:
      'A private key proves that a request really comes from you. Firebase and Google service accounts use one, and it often gives full access to a whole project.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      'Anyone who copies this key from your site can act as you. For a Firebase service account, that can mean reading and changing all of your data, skipping your security rules.',
    owasp: OWASP,
    cwe: ['CWE-200', 'CWE-321'],
  },
  'bundle-secrets:openai-key': {
    whatItIs:
      'An OpenAI API key lets a program use OpenAI and bills the usage to your account.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited: AI_KEY_EXPLOIT,
    owasp: OWASP,
    cwe: CWE,
  },
  'bundle-secrets:anthropic-key': {
    whatItIs:
      'An Anthropic API key lets a program use Claude and bills the usage to your account.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited: AI_KEY_EXPLOIT,
    owasp: OWASP,
    cwe: CWE,
  },
  'bundle-secrets:aws-key': {
    whatItIs:
      'This is the ID half of an AWS access key. It needs a matching secret to work, and that secret is often stored right next to it, though we only looked for the ID.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      'If the matching secret is in your code too, anyone who copies them can use your AWS account with whatever access the key has, which can include your files, your data, and your bill.',
    owasp: OWASP,
    cwe: CWE,
  },
} satisfies Record<`bundle-secrets:${string}`, Lesson>;
