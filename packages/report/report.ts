import type { AiTool, Technology } from '@soundcheck/shared';
import { buildFixPrompt } from './fix-prompt';
import { sortBySeverity } from './severity';
import type { Finding } from './types';

/** What one check did. Matches a check's result, plus its id and title. */
export type CheckOutcome = { checkId: string; title: string } & (
  | { status: 'ran'; findings: Finding[]; note?: string }
  | { status: 'skipped'; reason: string }
);

export interface ScanReport {
  url: string;
  /** ISO date and time. */
  scannedAt: string;
  /** AI tool to tailor the fix prompt for, if one was detected. */
  tool?: AiTool;
  /** What fingerprinting found. Missing means no clue was found, not that it isn't used. */
  stack?: Technology[];
  outcomes: CheckOutcome[];
  /** Kinds of checks this scan never tried, like ones that need domain verification. */
  notAttempted: { title: string; reason: string }[];
}

export interface NotCheckedItem {
  title: string;
  reason: string;
}

export interface ReportSummary {
  headline: string;
  /** Every finding, most severe first. */
  findings: Finding[];
  /** One prompt that fixes every finding, worst first. Undefined when there are none. */
  fixPrompt?: string;
  /** Checks that ran in full and found nothing. A partial or skipped check never lands here. */
  noProblemsFound: string[];
  /** Everything we couldn't vouch for. Each report must show this. */
  notChecked: NotCheckedItem[];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function headlineFor(findings: number, checksRan: number): string {
  if (findings > 0) {
    return 'Here are the vulnerabilities we found.';
  }
  if (checksRan > 0) {
    return `We didn't find any problems in the ${plural(checksRan, 'check', 'checks')} we ran. That doesn't mean your site is fully secure, so see what we didn't check below.`;
  }
  return "We couldn't check anything on this site, so we can't say whether it has problems.";
}

/** Turns scan results into what a report shows. Same input, same output. */
export function summarizeReport(report: ScanReport): ReportSummary {
  const findings = sortBySeverity(
    report.outcomes.flatMap((outcome) =>
      outcome.status === 'ran' ? outcome.findings : [],
    ),
  );

  const notChecked: NotCheckedItem[] = [];
  const noProblemsFound: string[] = [];
  let checksRan = 0;

  for (const outcome of report.outcomes) {
    if (outcome.status === 'skipped') {
      notChecked.push({ title: outcome.title, reason: outcome.reason });
      continue;
    }
    checksRan++;
    if (outcome.note) {
      notChecked.push({ title: outcome.title, reason: outcome.note });
    } else if (outcome.findings.length === 0) {
      noProblemsFound.push(outcome.title);
    }
  }
  notChecked.push(...report.notAttempted);

  return {
    headline: headlineFor(findings.length, checksRan),
    findings,
    fixPrompt:
      findings.length > 0
        ? buildFixPrompt(findings, report.tool, report.stack)
        : undefined,
    noProblemsFound,
    notChecked,
  };
}
