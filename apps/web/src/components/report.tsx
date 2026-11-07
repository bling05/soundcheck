import {
  LESSONS,
  summarizeReport,
  type Evidence,
  type Finding,
  type ScanReport,
} from '@soundcheck/report';
import { CopyButton } from './copy-button';

/** Just the place, for a closed block. The full line shows when it's opened. */
function evidenceWhere(evidence: Evidence): string {
  switch (evidence.kind) {
    case 'header':
      return evidence.header;
    case 'url':
      return new URL(evidence.url).pathname;
    case 'file':
      return evidence.line
        ? `${evidence.path}:${evidence.line}`
        : evidence.path;
  }
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function FindingBlock({ finding }: { finding: Finding }) {
  const { manualFix, evidence } = finding;
  const lesson = LESSONS[finding.lessonId];
  const [firstEvidence] = evidence;
  const severity = capitalize(finding.severity);
  return (
    <details className="finding">
      <summary>
        <span
          className={`dot severity-${finding.severity}`}
          aria-hidden="true"
        />
        <span className="finding-title">
          <span>{finding.title}</span>
          <code>
            {firstEvidence && evidenceWhere(firstEvidence)}
            {evidence.length > 1 && ` and ${evidence.length - 1} more`}
          </code>
        </span>
        <span className="finding-severity">{severity}</span>
      </summary>
      <div className="finding-body">
        <ul className="evidence">
          {evidence.map((item) => (
            <li key={`${evidenceWhere(item)}-${item.detail}`}>
              <code>{evidenceWhere(item)}</code>: {item.detail}
            </li>
          ))}
        </ul>
        <p>{lesson.howItIsExploited}</p>
        <p>
          {lesson.whatItIs} {lesson.whyAiToolsProduceIt}
        </p>
        <p>
          <strong>To fix it by hand:</strong> {manualFix.description}
        </p>
        <pre>
          <code>{manualFix.snippet}</code>
        </pre>
        <p className="muted">{[...lesson.owasp, ...lesson.cwe].join(' · ')}</p>
      </div>
    </details>
  );
}

function FixEverything({
  findings,
  prompt,
}: {
  findings: Finding[];
  prompt: string;
}) {
  const safetySteps = findings.filter(({ safetyStep }) => safetyStep);
  return (
    <section className="fix-all">
      {safetySteps.length > 0 && (
        <>
          <p>
            <strong>Do this first, because your AI tool can&apos;t:</strong>
          </p>
          <ul>
            {safetySteps.map(({ title, safetyStep }) => (
              <li key={title}>
                {title}. {safetyStep}
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        This one prompt covers everything above. Paste it into your AI tool.
      </p>
      <CopyButton text={prompt} />
      <details>
        <summary>See the prompt</summary>
        <pre>
          <code>{prompt}</code>
        </pre>
      </details>
    </section>
  );
}

export function Report({ report }: { report: ScanReport }) {
  const summary = summarizeReport(report);
  const scanned = new Date(report.scannedAt).toLocaleDateString('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  });

  return (
    <>
      <header>
        <h1>{new URL(report.url).hostname}</h1>
        <p className="muted">Scanned {scanned}.</p>
      </header>

      <p className="summary">{summary.headline}</p>

      {summary.findings.length > 0 && (
        <section>
          {summary.findings.map((finding) => (
            <FindingBlock finding={finding} key={finding.id} />
          ))}
        </section>
      )}

      {summary.fixPrompt && (
        <FixEverything findings={summary.findings} prompt={summary.fixPrompt} />
      )}

      {summary.noProblemsFound.length > 0 && (
        <section>
          <h2>No problems found</h2>
          <ul>
            {summary.noProblemsFound.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Some things we couldn&apos;t check</h2>
        <table>
          <tbody>
            {summary.notChecked.map(({ title, reason }) => (
              <tr key={title}>
                <th scope="row">{title}</th>
                <td>{reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>This scan is deterministic and does not use an LLM.</p>
      </section>
    </>
  );
}
