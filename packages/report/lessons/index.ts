import type { Lesson } from '../types';
import { BUNDLE_SECRETS_LESSONS } from './bundle-secrets';
import { FIREBASE_RULES_LESSONS } from './firebase-rules';
import { LEFTOVER_FILES_LESSONS } from './leftover-files';
import { NEXTJS_VERSION_LESSONS } from './nextjs-version';
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
  ...NEXTJS_VERSION_LESSONS,
  ...FIREBASE_RULES_LESSONS,
} satisfies Record<string, Lesson>;

export type LessonId = keyof typeof LESSONS;
