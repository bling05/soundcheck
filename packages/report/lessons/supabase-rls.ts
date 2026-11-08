import type { Lesson } from '../types';

export const SUPABASE_RLS_LESSONS = {
  'supabase-rls:readable-table': {
    whatItIs:
      "Supabase apps let the browser talk straight to the database, using a public key that's in your site's code. What keeps the data safe is Row Level Security (RLS): rules on each table saying who can see and change which rows. This table let us count its rows with nothing but that public key.",
    whyAiToolsProduceIt:
      'New Supabase tables can start with RLS turned off, and AI tools often build the feature first and skip the rules. When a query fails because of RLS, a common AI fix is to turn RLS off or add a rule that lets everyone read everything, which makes the error go away and the data public.',
    howItIsExploited:
      "Anyone can open your site, copy the public key from its code, and download this whole table in seconds. If RLS is off, they can usually change or delete rows too. This is how real AI-built apps have leaked their users' emails and messages.",
    realCase: {
      summary:
        "In February 2026, researchers found that Moltbook, a social network for AI agents, had left RLS off in its Supabase database. Using only the public key from the site's code, they could reach 1.5 million API tokens, about 35,000 email addresses, and thousands of private messages.",
      source: 'Wiz',
      url: 'https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys',
    },
    owasp: ['A01:2021 Broken Access Control'],
    cwe: ['CWE-284', 'CWE-862'],
  },
} satisfies Record<`supabase-rls:${string}`, Lesson>;
