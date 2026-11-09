import { bundleSecrets } from './bundle-secrets';
import { combineChecks } from './combine';
import { firebaseRules } from './firebase-rules';
import { firebaseStorage } from './firebase-storage';
import { leftoverFiles } from './leftover-files';
import { nextjsVersion } from './nextjs-version';
import { ownershipChecks } from './ownership';
import { supabasePolicies } from './supabase-policies';
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
export type {
  PlannedCheck,
  RunScanOptions,
  RunScanResult,
  ScanTarget,
} from './run-scan';
/** True once at least one check reads code, so the website can take repo links. */
export const REPO_SCANS_READY = (): boolean =>
  checks.some(({ mode }) => mode === 'repo');
export type { Check, CheckContext, CheckMode, CheckResult } from './types';
export {
  checkVerification,
  createVerificationSecret,
  VERIFICATION_FILE_PATH,
  VERIFICATION_META_NAME,
  verificationCode,
} from './verification';
export type { VerificationResult } from './verification';

/** Check #4: each platform's version, so a report shows one check either way. */
export const databaseRules = combineChecks(
  'database-rules',
  'Databases anyone can read',
  [
    { name: 'Supabase', check: supabaseRls },
    { name: 'Firebase', check: firebaseRules },
  ],
);

/** Check #5, the same way. */
export const storageRules = combineChecks(
  'storage-rules',
  'File storage anyone can list',
  [
    { name: 'Supabase', check: supabaseStorage },
    { name: 'Firebase', check: firebaseStorage },
  ],
);

/** In check-number order: #1 to #8. */
export const checks: readonly Check[] = [
  securityHeaders,
  bundleSecrets,
  leftoverFiles,
  databaseRules,
  storageRules,
  nextjsVersion,
  supabasePolicies,
  ownershipChecks,
];
