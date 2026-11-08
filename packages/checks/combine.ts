import { sortBySeverity } from '@soundcheck/report';
import type { Technology } from '@soundcheck/shared';
import type { Check, CheckContext, CheckResult } from './types';

interface Part {
  /** Named in notes, like `Supabase`. */
  name: string;
  check: Check;
}

function applies(check: Check, context: CheckContext): boolean {
  const found: readonly string[] = [
    ...context.platforms,
    ...(context.technologies ?? []),
  ];
  return (
    check.platforms === 'all' ||
    check.platforms.some((platform) => found.includes(platform))
  );
}

/**
 * One check made of a version for each platform, like "databases anyone can read" for
 * Supabase and for Firebase. Each part runs only on sites using its platform, so a report
 * shows one check either way. Findings keep their own ids, so rescans still match them,
 * and take the combined check's id, so a rescan knows which check covered them.
 */
export function combineChecks(
  id: string,
  title: string,
  parts: readonly Part[],
): Check {
  const modes = new Set(parts.map(({ check }) => check.mode));
  const [mode] = modes;
  if (!mode || modes.size > 1) {
    throw new Error(`${id}: every part must run in the same mode`);
  }
  const platforms = [
    ...new Set(
      parts.flatMap(({ check }) =>
        check.platforms === 'all' ? [] : check.platforms,
      ),
    ),
  ] as Technology[];

  async function run(context: CheckContext): Promise<CheckResult> {
    const active = parts.filter(({ check }) => applies(check, context));
    if (active.length === 0) {
      return {
        status: 'skipped',
        reason: "This check doesn't apply to what your site is built with.",
      };
    }
    const results = await Promise.all(
      active.map(async (part) => ({
        part,
        result: await part.check.run(context),
      })),
    );
    // One platform, the usual case: its result as it is, under this check's id.
    const label = (name: string, text: string) =>
      results.length > 1 ? `${name}: ${text}` : text;

    const ran = results.filter(({ result }) => result.status === 'ran');
    if (ran.length === 0) {
      return {
        status: 'skipped',
        reason: results
          .map(({ part, result }) =>
            label(part.name, result.status === 'skipped' ? result.reason : ''),
          )
          .join(' '),
      };
    }

    const findings = sortBySeverity(
      ran.flatMap(({ result }) =>
        result.status === 'ran'
          ? result.findings.map((finding) => ({ ...finding, checkId: id }))
          : [],
      ),
    );
    const notes = results.flatMap(({ part, result }) => {
      if (result.status === 'skipped') return [label(part.name, result.reason)];
      return result.note ? [label(part.name, result.note)] : [];
    });
    return notes.length > 0
      ? { status: 'ran', findings, note: notes.join(' ') }
      : { status: 'ran', findings };
  }

  return { id, title, mode, platforms, run };
}
