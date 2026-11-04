import { securityHeaders } from './security-headers';
import type { Check } from './types';

export { fingerprintSite } from './fingerprint';
export type { Detection, FingerprintResult, Technology } from './fingerprint';
export { guardedFetch, isPublicAddress } from './request-guard';
export type {
  GuardedFetch,
  GuardedFetchOptions,
  GuardedFetchResult,
  GuardFailureReason,
} from './request-guard';
export type { Check, CheckContext, CheckMode, CheckResult } from './types';

export const checks: readonly Check[] = [securityHeaders];
