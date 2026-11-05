import type { Technology } from '@soundcheck/shared';

const NAMES: Record<Technology, string> = {
  supabase: 'Supabase',
  firebase: 'Firebase',
  nextjs: 'Next.js',
  vite: 'Vite',
  vercel: 'Vercel',
  lovable: 'Lovable',
  bolt: 'Bolt',
  base44: 'Base44',
};

/** Names technologies in a sentence, like "Next.js, Supabase, and Vercel". */
export function describeStack(stack: readonly Technology[]): string {
  const names = stack.map((technology) => NAMES[technology]);
  if (names.length < 3) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
