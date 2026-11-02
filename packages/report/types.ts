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
  owasp: string[];
  cwe: string[];
}

export interface ManualFix {
  description: string;
  /** Language of the snippet, such as `sql` or `firestore-rules`. */
  language: string;
  snippet: string;
}

export interface Finding {
  checkId: string;
  title: string;
  severity: Severity;
  source: SourceTag;
  evidence: Evidence[];
  lesson: Lesson;
  manualFix: ManualFix;
  /** Ready-to-paste prompt tailored to the detected AI tool. */
  aiFixPrompt: string;
}
