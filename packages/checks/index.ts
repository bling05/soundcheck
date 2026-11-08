import { browserAiCalls } from './browser-ai-calls';
import { bundleSecrets } from './bundle-secrets';
import { firebaseRules } from './firebase-rules';
import { leftoverFiles } from './leftover-files';
import { nextjsVersion } from './nextjs-version';
import { supabaseRls } from './supabase-rls';
import { supabaseStorage } from './supabase-storage';
import { securityHeaders } from './security-headers';
import type { Check } from './types';

export { fingerprintSite } from './fingerprint';
export type { Detection, FingerprintResult, Technology } from './fingerprint';
export {
  guardedFetch,
  isPublicAddress,
  withRequestCache,
} from './request-guard';
export type {
  GuardedFetch,
  GuardedFetchOptions,
  GuardedFetchResult,
  GuardFailureReason,
} from './request-guard';
export {
  CHECK_TIME_LIMIT_MS,
  NOT_ATTEMPTED,
  runScan,
  SCAN_TIME_LIMIT_MS,
} from './run-scan';
export type { PlannedCheck, RunScanOptions, RunScanResult } from './run-scan';
export type { Check, CheckContext, CheckMode, CheckResult } from './types';
export {
  checkVerification,
  createVerificationSecret,
  VERIFICATION_FILE_PATH,
  VERIFICATION_META_NAME,
  verificationCode,
} from './verification';
export type { VerificationResult } from './verification';

export const checks: readonly Check[] = [
  securityHeaders,
  bundleSecrets,
  leftoverFiles,
  supabaseRls,
  supabaseStorage,
  nextjsVersion,
  firebaseRules,
  browserAiCalls,
];
