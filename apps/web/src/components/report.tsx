import {
  summarizeReport,
  type Evidence,
  type Finding,
  type ScanReport,
} from '@soundcheck/report';
import { CopyButton } from './copy-button';

function evidenceLine(evidence: Evidence): string {
  switch (evidence.kind) {
    case 'header':
      return `${evidence.header}: ${evidence.detail}`;
    case 'url':
      return `${new URL(evidence.url).pathname}: ${evidence.detail}`;
    case 'file': {
      const line = evidence.line ? `:${evidence.line}` : '';
      return `${evidence.path}${line}: ${evidence.detail}`;
    }
  }
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function FindingSection({ finding }: { finding: Finding }) {
  const { lesson, manualFix } = finding;
  return (
    <section className="finding">
      <h3>{finding.title}</h3>
      <p className={`severity severity-${finding.severity}`}>
        {capitalize(finding.severity)}
      </p>
      {finding.evidence.map((evidence) => (
        <p className="evidence" key={evidenceLine(evidence)}>
          <code>{evidenceLine(evidence)}</code>
        </p>
      ))}
      <p>{lesson.howItIsExploited}</p>
      {finding.safetyStep && (
        <p>
          <strong>Do this first:</strong> {finding.safetyStep}
        </p>
      )}
      <CopyButton text={finding.aiFixPrompt} />
      <details>
        <summary>Learn more</summary>
        <h4>What this is</h4>
        <p>{lesson.whatItIs}</p>
        <h4>Why AI tools do this</h4>
        <p>{lesson.whyAiToolsProduceIt}</p>
        <h4>How to fix it yourself</h4>
        <p>{manualFix.description}</p>
        <pre>
          <code>{manualFix.snippet}</code>
        </pre>
        <h4>Prompt for your AI tool</h4>
        <pre>
          <code>{finding.aiFixPrompt}</code>
        </pre>
        <p className="muted">{[...lesson.owasp, ...lesson.cwe].join(' · ')}</p>
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
        <p className="muted">Scanned {scanned}</p>
      </header>

      <section>
        <h2>{summary.headline}</h2>
        {summary.fixFirst && (
          <p>
            Start with: <strong>{summary.fixFirst.title}</strong>
          </p>
        )}
        {summary.severityCounts.length > 0 && (
          <p className="muted">
            {summary.severityCounts
              .map(({ severity, count }) => `${count} ${severity}`)
              .join(', ')}
          </p>
        )}
      </section>

      {summary.findings.length > 0 && (
        <section>
          <h2>What to fix</h2>
          {summary.findings.map((finding, index) => (
            <FindingSection
              finding={finding}
              key={`${finding.checkId}-${index}`}
            />
          ))}
        </section>
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
        <h2>Not checked</h2>
        <p>
          These aren&apos;t passes. We didn&apos;t test them, so they could
          still have problems.
        </p>
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
        <p>
          This scan is not a pentest. It looks for common problems using fixed
          rules, and a person testing your app could find things it can&apos;t.
        </p>
      </section>
    </>
  );
}
