import type { Finding } from '@soundcheck/report';
import type { AiTool, Platform } from '@soundcheck/shared';

export type CheckMode = 'url-passive' | 'url-active' | 'repo';

export interface CheckContext {
  /** Set for URL scans. */
  url?: string;
  /** Local path to the cloned repo. Set for repo scans. */
  repoPath?: string;
  /** Platforms found by fingerprinting. */
  platforms: Platform[];
  /** AI tool to tailor fix prompts for, if one was detected. */
  tool?: AiTool;
}

/** A skipped check is never a pass: `reason` is shown in the report's "Not checked" section. */
export type CheckResult =
  | { status: 'ran'; findings: Finding[] }
  | { status: 'skipped'; reason: string };

export interface Check {
  id: string;
  title: string;
  mode: CheckMode;
  /** Platforms this check applies to, or `all` for checks that don't depend on the backend. */
  platforms: readonly Platform[] | 'all';
  run(context: CheckContext): Promise<CheckResult>;
}
