import type { Lesson, RealCase } from '../types';

const OWASP = [
  'A02:2021 Cryptographic Failures',
  'A05:2021 Security Misconfiguration',
];
const CWE = ['CWE-200', 'CWE-798'];

const WHY_AI_TOOLS_PRODUCE_IT =
  "AI tools often connect a service the quickest way, by calling it straight from the browser. That works right away, but anything browser code uses gets sent to every visitor. Names starting with NEXT_PUBLIC_ or VITE_ do this too: they're copied into your public code.";

const AI_KEY_EXPLOIT =
  'Anyone who copies this key from your site can run requests on your account, and you get the bill. Leaked AI keys are a common target because they can be turned into money quickly.';

const SECRETS_STUDY: RealCase = {
  summary:
    'In 2025, researchers at Escape checked more than 5,600 live apps built with AI app builders and found over 400 exposed secrets, such as API keys, that anyone visiting could copy.',
  source: 'Escape',
  url: 'https://escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding/',
};

export const BUNDLE_SECRETS_LESSONS = {
  'bundle-secrets:supabase-secret': {
    whatItIs:
      'Supabase has two kinds of key. The anon key is meant to be public, and your security rules limit what it can do. The secret key, also called service role, skips those rules completely.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      'Anyone can open your site, read its code, and copy this key. With it they can read, change, or delete everything in your database, including all your users’ data.',
    realCase: SECRETS_STUDY,
    owasp: OWASP,
    cwe: CWE,
  },
  'bundle-secrets:stripe-secret': {
    whatItIs:
      'A Stripe secret key lets a program act as your business on Stripe. It is different from your publishable key, which starts with pk_ and is meant to be public.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      'Anyone who copies this key from your site may be able to see your customers and payments, or issue refunds, depending on what the key is allowed to do.',
    realCase: SECRETS_STUDY,
    owasp: OWASP,
    cwe: CWE,
  },
  'bundle-secrets:private-key': {
    whatItIs:
      'A private key proves that a request really comes from you. Firebase and Google service accounts use one, and it often gives full access to a whole project.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      'Anyone who copies this key from your site can act as you. For a Firebase service account, that can mean reading and changing all of your data, skipping your security rules.',
    realCase: SECRETS_STUDY,
    owasp: OWASP,
    cwe: ['CWE-200', 'CWE-321'],
  },
  'bundle-secrets:openai-key': {
    whatItIs:
      'An OpenAI API key lets a program use OpenAI and bills the usage to your account.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited: AI_KEY_EXPLOIT,
    realCase: SECRETS_STUDY,
    owasp: OWASP,
    cwe: CWE,
  },
  'bundle-secrets:anthropic-key': {
    whatItIs:
      'An Anthropic API key lets a program use Claude and bills the usage to your account.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited: AI_KEY_EXPLOIT,
    realCase: SECRETS_STUDY,
    owasp: OWASP,
    cwe: CWE,
  },
  'bundle-secrets:aws-key': {
    whatItIs:
      'This is the ID half of an AWS access key. It needs a matching secret to work, and that secret is often stored right next to it, though we only looked for the ID.',
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited:
      'If the matching secret is in your code too, anyone who copies them can use your AWS account with whatever access the key has, which can include your files, your data, and your bill.',
    realCase: SECRETS_STUDY,
    owasp: OWASP,
    cwe: CWE,
  },
  'bundle-secrets:google-api-key': {
    whatItIs:
      "Google API keys, which start with AIza, are meant to sit in your site's code for things like Google Maps and Firebase. But a key works for every Google service turned on in its project, and that can include Gemini, Google's AI, which is billed by use.",
    whyAiToolsProduceIt:
      "Google's own guides say to put these keys in browser code, so AI tools do, and that used to be fine. When someone later turns on Gemini in the same Google project, often an AI tool adding an AI feature, the old public key quietly starts working for Gemini too.",
    howItIsExploited:
      "Attackers collect Google keys from public websites and test them on Gemini. A key that works lets them run AI requests on your account, and you get the bill. We can't tell from outside whether Gemini is on for your key, so check it.",
    realCase: {
      summary:
        'In February 2026, researchers at Truffle Security found 2,863 public Google keys from websites that also worked on Gemini. Around the same time, a developer got a bill of over $82,000 after a stolen key was used for Gemini.',
      source: 'The Register',
      url: 'https://www.theregister.com/2026/03/03/gemini_api_key_82314_dollar_charge/',
    },
    owasp: ['A05:2021 Security Misconfiguration'],
    cwe: ['CWE-200', 'CWE-284'],
  },
} satisfies Record<`bundle-secrets:${string}`, Lesson>;
