import type { Finding } from '@soundcheck/report';
import type { CommittedSecretRule } from './rules';

interface SecretContent extends Pick<Finding, 'title' | 'severity'> {
  /** What the key is called in plain words, like `Stripe secret key`. */
  name: string;
  /** Where to make a new one. */
  newKeyFrom: string;
  /** The environment variable the code should read it from instead. */
  variable: string;
}

// The same grades as Check #2: a key in a public repo is just as public as one on the site.
export const SECRET_CONTENT: Record<CommittedSecretRule, SecretContent> = {
  'supabase-secret': {
    title: 'Your Supabase secret key is in your public repo',
    severity: 'critical',
    name: 'Supabase secret key',
    newKeyFrom: 'your Supabase project settings, under API Keys',
    variable: 'SUPABASE_SECRET_KEY',
  },
  'stripe-secret': {
    title: 'Your Stripe secret key is in your public repo',
    severity: 'critical',
    name: 'Stripe secret key',
    newKeyFrom: 'your Stripe dashboard, under Developers then API keys',
    variable: 'STRIPE_SECRET_KEY',
  },
  'private-key': {
    title: 'A private key is in your public repo',
    severity: 'critical',
    name: 'private key',
    newKeyFrom:
      'the service that issued it, such as your Firebase or Google Cloud service accounts',
    variable: 'SERVICE_ACCOUNT_KEY',
  },
  'database-url': {
    title: 'Your database password is in your public repo',
    severity: 'critical',
    name: 'database password',
    newKeyFrom: "your database host's settings, by resetting the password",
    variable: 'DATABASE_URL',
  },
  'openai-key': {
    title: 'Your OpenAI API key is in your public repo',
    severity: 'high',
    name: 'OpenAI API key',
    newKeyFrom: 'your OpenAI dashboard',
    variable: 'OPENAI_API_KEY',
  },
  'anthropic-key': {
    title: 'Your Anthropic API key is in your public repo',
    severity: 'high',
    name: 'Anthropic API key',
    newKeyFrom: 'your Anthropic Console',
    variable: 'ANTHROPIC_API_KEY',
  },
  'aws-key': {
    title: 'An AWS key is in your public repo',
    severity: 'high',
    name: 'AWS access key',
    newKeyFrom: 'your AWS account, under IAM',
    variable: 'AWS_SECRET_ACCESS_KEY',
  },
};

export const GITIGNORE_SNIPPET =
  '# Settings with secrets. Never commit these.\n.env\n.env.*\n!.env.example';
