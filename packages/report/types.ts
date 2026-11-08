import type { LessonId } from './lessons';
import type { Severity } from './severity';

/** Where a finding was seen. `both` means a code finding was confirmed live ("Confirmed exploitable"). */
export type SourceTag = 'code' | 'live' | 'both';

/** What triggered a finding. Secrets must be redacted and data reported as counts, never contents. */
export type Evidence =
  | { kind: 'url'; url: string; detail: string }
  | { kind: 'header'; url: string; header: string; detail: string }
  | { kind: 'file'; path: string; line?: number; detail: string };

export interface Lesson {
  whatItIs: string;
  whyAiToolsProduceIt: string;
  howItIsExploited: string;
  /** A real breach or study showing this problem, when a well-sourced one exists. */
  realCase?: RealCase;
  owasp: string[];
  cwe: string[];
}

export interface RealCase {
  /** What happened, in plain words. Only facts the source states. */
  summary: string;
  /** Who reported it, shown as the link text, like `Wiz`. */
  source: string;
  url: string;
}

export interface ManualFix {
  description: string;
  /** Language of the snippet, such as `sql` or `firestore-rules`. */
  language: string;
  snippet: string;
}

export interface AiFix {
  /** What the scan found, without a closing period. */
  problem: string;
  /** What to ask the AI tool to do about it. */
  request: string;
}

export interface Finding {
  /**
   * The same problem in the same place gets the same id on every scan, so
   * rescans can tell what's fixed. Build it with `findingId`.
   */
  id: string;
  checkId: string;
  title: string;
  severity: Severity;
  source: SourceTag;
  evidence: Evidence[];
  /** Which entry in `LESSONS` explains this problem. Shared by every finding of the same kind. */
  lessonId: LessonId;
  manualFix: ManualFix;
  /** Something urgent to do before the fix, like replacing a leaked key. */
  safetyStep?: string;
  /** This finding's part of the report's single fix prompt. See `buildFixPrompt`. */
  aiFix: AiFix;
}
