import { findingId, withUniqueIds, type Finding } from '@soundcheck/report';
import { readSite } from '../site-files';
import type { Check, CheckContext, CheckResult } from '../types';
import {
  browserCallFinding,
  coveredByKey,
  findBrowserCalls,
} from './browser-ai';
import { RULE_CONTENT } from './content';
import { findLeaks } from './rules';

const CHECK_ID = 'bundle-secrets';
const MAX_EVIDENCE_FILES = 5;

const REPLACE_KEY_FIRST =
  "Create a new key and delete this one. Removing it from your code isn't enough, because anyone who already copied it can keep using it until it's deleted.";

const PARTIAL_READ =
  "We couldn't read all of your site's code, so there could be more keys we didn't see.";

async function run(context: CheckContext): Promise<CheckResult> {
  if (!context.url) {
    return {
      status: 'skipped',
      reason: 'This check needs a link to your site.',
    };
  }

  const site = await readSite(context.url, context.fetch);
  if (!site.ok) return { status: 'skipped', reason: site.message };
  if (site.status >= 400) {
    return {
      status: 'skipped',
      reason: `Your site answered with error ${site.status}, so we couldn't read its code.`,
    };
  }

  const leaks = findLeaks(site.files);
  const leakedRules = new Set(leaks.map(({ rule }) => rule));
  // AI services called from the browser expose their key even when it isn't written in
  // the code. When the key itself was found, that finding already covers it.
  const browserCalls = findBrowserCalls(site.files).filter(
    (call) => !coveredByKey(call, leakedRules),
  );

  // Finding nothing after reading only part of a site must never look like a pass.
  if (!site.complete && leaks.length === 0 && browserCalls.length === 0) {
    return { status: 'skipped', reason: PARTIAL_READ };
  }

  const found = leaks.map(({ rule, redacted, locations }): Finding => {
    const { title, severity, manualFix, fixRequest, safetyStep } =
      RULE_CONTENT[rule];
    return {
      // The redacted key, so the same leaked key keeps its id until it's replaced.
      id: findingId(CHECK_ID, rule, redacted),
      checkId: CHECK_ID,
      title,
      severity,
      source: 'live',
      safetyStep: safetyStep ?? REPLACE_KEY_FIRST,
      evidence: locations.slice(0, MAX_EVIDENCE_FILES).map((url) => ({
        kind: 'url',
        url,
        detail: `Found a key ending in ${redacted} in this file.`,
      })),
      lessonId: `${CHECK_ID}:${rule}`,
      manualFix,
      aiFix: {
        problem: `${title}. The key ends in ${redacted}`,
        request: fixRequest,
      },
    };
  });
  const findings = withUniqueIds([
    ...found,
    ...browserCalls.map(browserCallFinding),
  ]);

  return site.complete
    ? { status: 'ran', findings }
    : { status: 'ran', findings, note: PARTIAL_READ };
}

export const bundleSecrets: Check = {
  id: CHECK_ID,
  title: 'Secret keys in public code',
  mode: 'url-passive',
  platforms: 'all',
  run,
};
