import type { Lesson } from '../types';
import { BUNDLE_SECRETS_LESSONS } from './bundle-secrets';
import { LEFTOVER_FILES_LESSONS } from './leftover-files';
import { SECURITY_HEADERS_LESSONS } from './security-headers';
import { SUPABASE_RLS_LESSONS } from './supabase-rls';
import { SUPABASE_STORAGE_LESSONS } from './supabase-storage';

/**
 * Every lesson, written once. Findings point to one by its id,
 * `checkId:rule`, so reports and the Learn section show the same text.
 */
export const LESSONS = {
  ...SECURITY_HEADERS_LESSONS,
  ...BUNDLE_SECRETS_LESSONS,
  ...LEFTOVER_FILES_LESSONS,
  ...SUPABASE_RLS_LESSONS,
  ...SUPABASE_STORAGE_LESSONS,
} satisfies Record<string, Lesson>;

export type LessonId = keyof typeof LESSONS;
