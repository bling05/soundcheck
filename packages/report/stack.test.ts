import { describe, expect, it } from 'vitest';
import { describeStack } from './stack';

describe('describeStack', () => {
  it.each([
    [[], ''],
    [['vite'], 'Vite'],
    [['supabase', 'vite'], 'Supabase and Vite'],
    [['supabase', 'nextjs', 'vercel'], 'Supabase, Next.js, and Vercel'],
  ] as const)('names %j', (stack, expected) => {
    expect(describeStack(stack)).toBe(expected);
  });
});
