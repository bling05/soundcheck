import type { Lesson, RealCase } from '../types';
import { BUNDLE_SECRETS_LESSONS } from './bundle-secrets';

const OWASP = [
  'A02:2021 Cryptographic Failures',
  'A05:2021 Security Misconfiguration',
];
const CWE = ['CWE-798', 'CWE-540'];

const WHY_AI_TOOLS_PRODUCE_IT =
  "When a feature needs a key, the quickest way to make it work is to paste the key into the code, and AI tools often do, or suggest you do. Keys also get committed by accident: a .env file that .gitignore doesn't cover gets saved along with everything else, and AI tools that commit for you don't always notice.";

const HOW_IT_IS_EXPLOITED =
  "Anyone can read a public repo, and bots watch new commits on GitHub for keys and try them right away. Deleting the key later doesn't help: the old commit still has it, so the key has to be replaced. We read only the latest version of your code, so a key you deleted earlier won't show here, but it's still in your history.";

const UBER: RealCase = {
  summary:
    'In 2016, attackers found an access key that an Uber engineer had posted on a code-sharing site. They used it to download data on more than 25 million U.S. Uber riders and drivers from Uber’s cloud storage.',
  source: 'FTC',
  url: 'https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims',
};

function committed(whatTheKeyIs: string): Lesson & { realCase: RealCase } {
  return {
    whatItIs: `${whatTheKeyIs} This one is written in a file in your public repo, where anyone can read it.`,
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited: HOW_IT_IS_EXPLOITED,
    realCase: UBER,
    owasp: OWASP,
    cwe: CWE,
  };
}

const site = BUNDLE_SECRETS_LESSONS;

export const REPO_SECRETS_LESSONS = {
  'repo-secrets:supabase-secret': committed(
    site['bundle-secrets:supabase-secret'].whatItIs,
  ),
  'repo-secrets:stripe-secret': committed(
    site['bundle-secrets:stripe-secret'].whatItIs,
  ),
  'repo-secrets:private-key': committed(
    site['bundle-secrets:private-key'].whatItIs,
  ),
  'repo-secrets:openai-key': committed(
    site['bundle-secrets:openai-key'].whatItIs,
  ),
  'repo-secrets:anthropic-key': committed(
    site['bundle-secrets:anthropic-key'].whatItIs,
  ),
  'repo-secrets:aws-key': committed(
    'An AWS access key lets a program use your AWS account, with whatever access the key was given. That can include your files, your databases, and your bill.',
  ),
  'repo-secrets:database-url': committed(
    "A database address like postgres://user:password@host includes your database's password. With it, anyone can connect straight to your database and read, change, or delete everything, skipping your app and its security rules.",
  ),
  'repo-secrets:env-file': {
    whatItIs:
      "A .env file holds your app's settings, including secrets like API keys and database passwords, so they stay out of your code. It's meant to stay on your computer and in your hosting settings. This one is committed to your public repo, so everyone can read every secret in it.",
    whyAiToolsProduceIt: WHY_AI_TOOLS_PRODUCE_IT,
    howItIsExploited: HOW_IT_IS_EXPLOITED,
    realCase: UBER,
    owasp: OWASP,
    cwe: ['CWE-538', 'CWE-798'],
  },
  'repo-secrets:env-not-ignored': {
    whatItIs:
      ".gitignore tells git which files never to save to your repo. Your app reads settings from environment variables, which usually live in a .env file, but your .gitignore doesn't list .env. Nothing has leaked yet, but the next time a .env file is created, it would be committed and published along with your code.",
    whyAiToolsProduceIt:
      "Project templates usually set up .gitignore, but projects started by hand or by an AI tool sometimes skip it, and adding a .env file later doesn't update it.",
    howItIsExploited:
      'Once a .env file is committed to a public repo, anyone can read the secrets in it, and bots that watch GitHub for keys find them quickly.',
    owasp: ['A05:2021 Security Misconfiguration'],
    cwe: ['CWE-538'],
  },
} satisfies Record<`repo-secrets:${string}`, Lesson>;
