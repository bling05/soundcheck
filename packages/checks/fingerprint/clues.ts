import type { Technology } from '@soundcheck/shared';

export type { Technology };

export interface Clue {
  technology: Technology;
  /** Plain description of what was found. Fixed text, so no site content reaches a report. */
  description: string;
  /** host: the site's address. headers: `name: value` lines. content: the page and its code files. */
  searchIn: 'host' | 'headers' | 'content';
  pattern: RegExp;
}

// Keep these narrow. A blog post that mentions Supabase shouldn't count as using it, so
// content patterns match real project addresses and build output, not just product names.
// Order matters: results come back in this order, so the same site always reads the same.
export const CLUES: readonly Clue[] = [
  {
    technology: 'supabase',
    description: 'Code contains a Supabase project address',
    searchIn: 'content',
    pattern: /https?:\/\/[a-z0-9]{20}\.supabase\.(?:co|in)\b/,
  },
  {
    // Lovable Cloud is Supabase behind Lovable's own address.
    technology: 'supabase',
    description: 'Code contains a Lovable Cloud database address',
    searchIn: 'content',
    pattern: /https:\/\/[a-z0-9-]+\.lovable\.cloud\b/,
  },
  {
    // Build tools copy public settings into the code by name, so this is build output.
    technology: 'supabase',
    description: 'Code contains a Supabase address setting',
    searchIn: 'content',
    pattern: /\b(?:VITE|NEXT_PUBLIC|REACT_APP|EXPO_PUBLIC)_SUPABASE_URL\b/,
  },
  {
    technology: 'firebase',
    description: 'Site is hosted on Firebase',
    searchIn: 'host',
    pattern: /\.(?:web\.app|firebaseapp\.com)$/,
  },
  {
    technology: 'firebase',
    description: 'Code contains a Firebase project address',
    searchIn: 'content',
    pattern:
      /[a-z0-9-]+\.(?:firebaseapp\.com|firebaseio\.com|firebasedatabase\.app)\b/,
  },
  {
    technology: 'firebase',
    description: 'Code contains a Firebase service address',
    searchIn: 'content',
    pattern: /\b(?:firestore|firebasestorage)\.googleapis\.com\b/,
  },
  {
    technology: 'nextjs',
    description: 'A response header names Next.js',
    searchIn: 'headers',
    pattern: /^x-powered-by: next\.js/im,
  },
  {
    technology: 'nextjs',
    description: 'Page loads files from /_next/static/',
    searchIn: 'content',
    pattern: /["'(]\/_next\/static\//,
  },
  {
    technology: 'vite',
    description: 'Page loads a Vite-style build file',
    searchIn: 'content',
    pattern:
      /<script\b[^>]*\btype="module"[^>]*\bsrc="[^"]*\/assets\/[^"/]+-[\w-]{8,}\.js"/,
  },
  {
    technology: 'vercel',
    description: 'Site is hosted on a vercel.app address',
    searchIn: 'host',
    pattern: /\.vercel\.app$/,
  },
  {
    technology: 'vercel',
    description: 'A response header comes from Vercel',
    searchIn: 'headers',
    pattern: /^(?:x-vercel-id:|server: vercel$)/im,
  },
  {
    technology: 'lovable',
    description: 'Site is hosted on a Lovable address',
    searchIn: 'host',
    pattern: /\.(?:lovable\.app|lovableproject\.com)$/,
  },
  {
    technology: 'lovable',
    description: 'Page uses a Lovable template file',
    searchIn: 'content',
    pattern: /lovable\.dev\/opengraph-image|cdn\.gpteng\.co\/gptengineer\.js/,
  },
  {
    technology: 'bolt',
    description: 'Site is hosted on a Bolt address',
    searchIn: 'host',
    pattern: /\.bolt\.host$/,
  },
  {
    technology: 'base44',
    description: 'Site is hosted on a Base44 address',
    searchIn: 'host',
    pattern: /\.base44\.app$/,
  },
];
