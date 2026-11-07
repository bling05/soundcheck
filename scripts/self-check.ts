/**
 * Soundcheck must pass its own checks. This scans a local copy of the site with the real
 * checks and fails if anything is found, or if anything couldn't be checked.
 *
 * Start the production site first (`npm run build`, then `npm run start --workspace=@soundcheck/web`),
 * then run `npm run self-check`. CI does both on every pull request.
 */
import { checks, runScan } from '@soundcheck/checks';
import { testFetchFor } from '../packages/checks/request-guard/test-fetch';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const port = Number(new URL(url).port || 80);

// The test fetch only ever reaches this machine on this one port, so the scan can't wander.
const result = await runScan(url, { fetch: testFetchFor({ port }), checks });
if (!result.ok) {
  console.error(`Couldn't scan ${url}: ${result.message}`);
  console.error('Is the site running?');
  process.exit(1);
}

let failed = false;
for (const outcome of result.report.outcomes) {
  if (outcome.status === 'skipped') {
    failed = true;
    console.log(`✗ ${outcome.title}: couldn't check. ${outcome.reason}`);
    continue;
  }
  if (outcome.note) {
    failed = true;
    console.log(`✗ ${outcome.title}: only partly checked. ${outcome.note}`);
  }
  if (outcome.findings.length === 0) {
    if (!outcome.note) console.log(`✓ ${outcome.title}`);
    continue;
  }
  failed = true;
  console.log(`✗ ${outcome.title}`);
  for (const finding of outcome.findings) {
    console.log(`    ${finding.severity}: ${finding.title}`);
  }
}

console.log(
  failed
    ? '\nSoundcheck does not pass its own checks.'
    : '\nSoundcheck passes all of its own checks.',
);
process.exit(failed ? 1 : 0);
