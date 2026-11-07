import type { PlannedCheck, Scan } from '@soundcheck/db';
import type { CheckOutcome } from '@soundcheck/report';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function resultText(outcome: CheckOutcome): string {
  if (outcome.status === 'skipped') return "Couldn't check";
  const found = outcome.findings.length;
  if (found === 0) return 'No problems found';
  const text = `Found ${plural(found, 'problem', 'problems')}`;
  return outcome.note ? `${text}, but couldn't check everything` : text;
}

function stateOf(
  check: PlannedCheck,
  outcomes: readonly CheckOutcome[],
  firstUnfinished: string | undefined,
): string {
  const outcome = outcomes.find(({ checkId }) => checkId === check.id);
  if (outcome) return resultText(outcome);
  return check.id === firstUnfinished ? 'Checking…' : 'Waiting';
}

/** What a scan shows before its report is ready: each check and how it's going. */
export function ScanProgress({ scan }: { scan: Scan }) {
  const hostname = new URL(scan.url).hostname;
  const outcomes = scan.report?.outcomes ?? [];
  const firstUnfinished = scan.checks.find(
    ({ id }) => !outcomes.some(({ checkId }) => checkId === id),
  )?.id;

  return (
    <>
      <h1>{hostname}</h1>
      <p aria-live="polite">
        {scan.status === 'queued' && 'Starting…'}
        {scan.status === 'running' &&
          (scan.checks.length === 0
            ? 'Looking at how your site is built…'
            : `Scanning. ${outcomes.length} of ${scan.checks.length} checks done.`)}
      </p>
      {scan.checks.length > 0 && (
        <table>
          <tbody>
            {scan.checks.map((check) => (
              <tr key={check.id}>
                <th scope="row">{check.title}</th>
                <td>{stateOf(check, outcomes, firstUnfinished)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
