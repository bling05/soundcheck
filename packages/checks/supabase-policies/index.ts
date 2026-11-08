import { findingId, sortBySeverity, type Finding } from '@soundcheck/report';
import { tableKind } from '../supabase-rls/rules';
import type { Check, CheckContext, CheckResult } from '../types';
import {
  detailFor,
  fixFor,
  fixRequestFor,
  severityFor,
  titleFor,
} from './content';
import { findProblems } from './rules';
import { readSchema } from './schema';

const CHECK_ID = 'supabase-policies';

async function run(context: CheckContext): Promise<CheckResult> {
  if (!context.repo) {
    return { status: 'skipped', reason: 'This check needs your repo.' };
  }
  const schema = readSchema(context.repo.files);
  if (schema.filesRead === 0) {
    return {
      status: 'skipped',
      reason:
        "We couldn't find Supabase migration files in your repo, like supabase/migrations/*.sql, so we couldn't read your database rules.",
    };
  }

  const problems = findProblems(
    schema,
    (table) => tableKind(table) === 'probably-public',
  );
  const findings = problems.map((problem): Finding => {
    const title = titleFor(problem);
    return {
      id: findingId(CHECK_ID, problem.rule, problem.table),
      checkId: CHECK_ID,
      title,
      severity: severityFor(problem.rule, tableKind(problem.table)),
      source: 'code',
      evidence: [
        {
          kind: 'file',
          path: problem.place.path,
          line: problem.place.line,
          detail: detailFor(problem),
        },
      ],
      lessonId: `${CHECK_ID}:${problem.rule}`,
      manualFix: fixFor(problem),
      aiFix: { problem: title, request: fixRequestFor(problem) },
    };
  });

  const result: CheckResult = {
    status: 'ran',
    findings: sortBySeverity(findings),
  };
  return context.repo.complete
    ? result
    : {
        ...result,
        note: "Some files in your repo were too big to read, so there could be rules we didn't see.",
      };
}

export const supabasePolicies: Check = {
  id: CHECK_ID,
  title: 'Supabase database rules in your code',
  mode: 'repo',
  platforms: ['supabase'],
  run,
};
