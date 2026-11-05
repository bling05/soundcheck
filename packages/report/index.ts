export { buildFixPrompt } from './fix-prompt';
export { summarizeReport } from './report';
export type {
  CheckOutcome,
  NotCheckedItem,
  ReportSummary,
  ScanReport,
} from './report';
export { describeStack } from './stack';
export { SEVERITIES, sortBySeverity } from './severity';
export type { Severity } from './severity';
export type {
  AiFix,
  Evidence,
  Finding,
  Lesson,
  ManualFix,
  SourceTag,
} from './types';
