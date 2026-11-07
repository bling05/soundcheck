import { bundleSecrets } from './bundle-secrets';
import { leftoverFiles } from './leftover-files';
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

export const checks: readonly Check[] = [
  securityHeaders,
  bundleSecrets,
  leftoverFiles,
];
