import type { Lesson, RealCase } from '../types';

const OWASP = ['A01:2021 Broken Access Control'];

const LOVABLE_NOTICE: RealCase = {
  summary:
    "In 2025, a public security notice (CVE-2025-48757) reported that apps built with Lovable through April 2025 had database rules that let visitors who weren't signed in read or change their data. Lovable disputes it, saying each app's owner is responsible for its rules.",
  source: 'NIST National Vulnerability Database',
  url: 'https://nvd.nist.gov/vuln/detail/CVE-2025-48757',
};

const MOLTBOOK: RealCase = {
  summary:
    "In February 2026, researchers found that Moltbook, a social network for AI agents, had left RLS off in its Supabase database. Using only the public key from the site's code, they could reach 1.5 million API tokens, about 35,000 email addresses, and thousands of private messages.",
  source: 'Wiz',
  url: 'https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys',
};

const WHERE_RULES_LIVE =
  "Supabase apps let the browser talk straight to the database with a public key, and Row Level Security (RLS) policies decide who can see and change each row. Your migration files, the SQL in supabase/migrations, are where those policies are written. We read them; anything changed only in the Supabase dashboard isn't in your repo, so we can't see it.";

export const SUPABASE_POLICIES_LESSONS = {
  'supabase-policies:rls-off': {
    whatItIs: `${WHERE_RULES_LIVE} This table is created without RLS ever being turned on.`,
    whyAiToolsProduceIt:
      'AI tools often write the table first and the rules later, or never. When a query fails because of RLS, a common AI fix is to turn RLS off, which makes the error go away and the data public.',
    howItIsExploited:
      'Anyone can copy the public key from your site and read, change, or delete every row in this table, with a few lines of code.',
    realCase: MOLTBOOK,
    owasp: OWASP,
    cwe: ['CWE-284', 'CWE-862'],
  },
  'supabase-policies:everyone-can-read': {
    whatItIs: `${WHERE_RULES_LIVE} This policy says "true" for reading, with no condition, for everyone.`,
    whyAiToolsProduceIt:
      'A policy of "true" is the quickest way to make a "permission denied" error go away, so AI tools reach for it, even on tables full of personal data.',
    howItIsExploited:
      "Anyone, signed in or not, can copy your site's public key and download the whole table.",
    realCase: LOVABLE_NOTICE,
    owasp: OWASP,
    cwe: ['CWE-284', 'CWE-863'],
  },
  'supabase-policies:any-user-can-read': {
    whatItIs: `${WHERE_RULES_LIVE} This policy only checks that someone is signed in, not that the row is theirs.`,
    whyAiToolsProduceIt:
      '"Only signed-in users" sounds safe, so AI tools write it when asked to protect a table. It skips the part that matters: whose row it is.',
    howItIsExploited:
      "Anyone can make a free account, sign in, and then read every user's rows. The login protects nothing, because it's open to everyone.",
    owasp: OWASP,
    cwe: ['CWE-639', 'CWE-863'],
  },
  'supabase-policies:write-as-anyone': {
    whatItIs: `${WHERE_RULES_LIVE} This policy's WITH CHECK, which decides what may be saved, doesn't require the row's owner to be the person saving it.`,
    whyAiToolsProduceIt:
      'AI tools often protect reading and forget writing, or use "true" for WITH CHECK so saving never fails.',
    howItIsExploited:
      "A signed-in user can save rows in someone else's name: post as them, add items to their account, or move a row onto another user, by changing the owner column in the request.",
    owasp: OWASP,
    cwe: ['CWE-639', 'CWE-284'],
  },
  'supabase-policies:trusts-user-metadata': {
    whatItIs:
      "Supabase keeps two kinds of extra details on each user. user_metadata, which includes what someone typed when signing up, can be changed by the user at any time from the browser. app_metadata can only be changed by your server. Your database decides who someone is, like whether they're an admin, from user_metadata.",
    whyAiToolsProduceIt:
      "Storing a role in user_metadata is the easiest place to put it, and it's visible in the login token, so AI tools often check it in policies or copy it into a profile when someone signs up.",
    howItIsExploited:
      'Anyone can sign up, then set their own role to admin with one line of code in the browser, or sign up with role set to admin from the start, and get whatever that role allows.',
    owasp: OWASP,
    cwe: ['CWE-269', 'CWE-639'],
  },
} satisfies Record<`supabase-policies:${string}`, Lesson>;
